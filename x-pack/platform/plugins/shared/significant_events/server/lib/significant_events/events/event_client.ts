/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IDataStreamClient } from '@kbn/data-streams';
import { esql, type ComposerSortShorthand } from '@elastic/esql';
import type { ESQLAstExpression } from '@elastic/esql/types';
import type { ElasticsearchClient } from '@kbn/core/server';
import { severityFromStoredSchema, type StoredSeverity } from '@kbn/significant-events-schema';
import {
  type BulkCreateOptions,
  type CommonSearchOptions,
  type PaginatedSearchOptions,
  type PaginatedResponse,
  throwOnBulkCreateErrors,
} from '../query_utils';
import {
  andWhere,
  applyTimeRange,
  esqlToObjects,
  executeAndDecodeSource,
  fromIndexForSpace,
  inFilter,
  isIndexNotFoundError,
  pickLatestPerGroup,
  queryEsql,
  runLatestSourceEsqlQuery,
  runPaginatedLatestSourceEsqlQuery,
  runFindByIdEsqlQuery,
  withSort,
  withWhere,
} from '../latest_source_query';
import {
  EVENTS_DATA_STREAM,
  storedEventSchema,
  type SignificantEvent,
  type StoredEvent,
  type eventsMappings,
} from './data_stream';
import { FIELD_EVENT_UUID, FIELD_EVENT_ID } from '../field_names';

/**
 * Shape of a raw ES document before decoding — identical to `SignificantEvent` except
 * `severity`, which is stored as a sortable keyword (e.g. `"80-critical"`) rather than the
 * domain enum.
 */
type RawEventRow = Omit<SignificantEvent, 'severity'> & { severity: StoredSeverity };

/** Decode a raw ES document's stored severity keyword (e.g. `"80-critical"`) into domain form. */
const decodeSeverity = (doc: RawEventRow): SignificantEvent => ({
  ...doc,
  severity: severityFromStoredSchema.parse(doc.severity),
});

export type EventDataStreamClient = IDataStreamClient<typeof eventsMappings, StoredEvent>;

const SIGNIFICANT_EVENT_OPEN_STATUS = 'open' as const;

export interface EventsFilterOptions {
  status?: string[];
  stream?: string[];
  search?: string;
}

export interface EventsPaginatedSearchOptions extends PaginatedSearchOptions, EventsFilterOptions {}

export type EventStateFilter = 'open' | 'closed';

export interface EventsCurrentStatePaginatedSearchOptions extends PaginatedSearchOptions {
  state: EventStateFilter;
  stream?: string[];
  search?: string;
}

export class EventClient {
  constructor(
    private readonly clients: {
      dataStreamClient: EventDataStreamClient;
      esClient: ElasticsearchClient;
      space: string;
    }
  ) {}

  private buildWhere(options: EventsFilterOptions): ESQLAstExpression | undefined {
    let where: ESQLAstExpression | undefined;
    where = inFilter({ where, field: 'status', values: options.status });
    where = inFilter({ where, field: 'stream_names', values: options.stream });

    if (options.search) {
      const escaped = options.search.toLowerCase().replace(/\\/g, '\\\\').replace(/[*?]/g, '\\$&');
      const pattern = esql.str(`*${escaped}*`);
      where = andWhere(
        where,
        esql.exp`(TO_LOWER(${esql.col('title')}) LIKE ${pattern} OR TO_LOWER(${esql.col(
          'summary'
        )}) LIKE ${pattern})`
      );
    }

    return where;
  }

  async bulkCreate(
    events: SignificantEvent[],
    { throwOnFail = false, refresh }: BulkCreateOptions = {}
  ) {
    const response = await this.clients.dataStreamClient.create({
      space: this.clients.space,
      documents: events.map((e) => storedEventSchema.parse(e)),
      refresh,
    });

    if (throwOnFail) {
      throwOnBulkCreateErrors(response);
    }

    return response;
  }

  async findLatest(options: CommonSearchOptions = {}): Promise<{ hits: SignificantEvent[] }> {
    const result = await runLatestSourceEsqlQuery<RawEventRow>({
      esClient: this.clients.esClient,
      space: this.clients.space,
      options,
      index: EVENTS_DATA_STREAM,
      groupBy: FIELD_EVENT_ID,
    });
    return { hits: result.hits.map(decodeSeverity) };
  }

  async findLatestPaginated(
    options: EventsPaginatedSearchOptions = {}
  ): Promise<PaginatedResponse<SignificantEvent>> {
    const result = await runPaginatedLatestSourceEsqlQuery<RawEventRow>({
      esClient: this.clients.esClient,
      space: this.clients.space,
      options,
      index: EVENTS_DATA_STREAM,
      where: this.buildWhere(options),
      groupBy: FIELD_EVENT_ID,
    });

    return { ...result, hits: result.hits.map(decodeSeverity) };
  }

  async findLatestByCurrentStatePaginated(
    options: EventsCurrentStatePaginatedSearchOptions
  ): Promise<PaginatedResponse<SignificantEvent>> {
    const page = options.page ?? 1;
    const perPage = options.perPage ?? 25;

    const stateWhere =
      options.state === 'open'
        ? esql.exp`${esql.col('status')} == ${esql.str(SIGNIFICANT_EVENT_OPEN_STATUS)}`
        : esql.exp`${esql.col('status')} != ${esql.str(SIGNIFICANT_EVENT_OPEN_STATUS)}`;

    // ComposerQuery is mutable — each chaining call mutates the same object and returns `this`.
    // Build the base query twice via a factory so the data branch and count branch get independent
    // instances; sharing a single reference causes the count pipeline to corrupt the data query.
    const buildBase = () => {
      let q = applyTimeRange({
        query: fromIndexForSpace({
          index: EVENTS_DATA_STREAM,
          space: this.clients.space,
          columns: ['_id', '_source'],
        }),
        from: options.from,
        to: options.to,
      });
      // stream + search filters run pre-latest; state filter runs post-latest
      q = withWhere(q, this.buildWhere({ stream: options.stream, search: options.search }));
      q = pickLatestPerGroup(q, FIELD_EVENT_ID);
      q = withWhere(q, stateWhere);
      return q;
    };

    const sortArgs: ComposerSortShorthand[] = [['@timestamp', 'DESC']];
    const dataQuery = withSort(buildBase(), sortArgs)
      .limit(page * perPage)
      .keep('_source');
    const countQuery = buildBase().pipe`STATS total = COUNT(*)`.keep('total');

    const [countResponse, { hits }] = await Promise.all([
      queryEsql({ esClient: this.clients.esClient, query: countQuery }).catch((error) => {
        if (isIndexNotFoundError(error)) return null;
        throw error;
      }),
      executeAndDecodeSource<RawEventRow>(this.clients.esClient, dataQuery),
    ]);

    const total = countResponse
      ? esqlToObjects<{ total: number }>(countResponse)[0]?.total ?? 0
      : 0;
    const start = (page - 1) * perPage;
    const paginatedHits = start >= hits.length ? [] : hits.slice(start, start + perPage);

    return {
      hits: paginatedHits.map(decodeSeverity),
      page,
      perPage,
      total,
    };
  }

  async findByEventUuid(id: string): Promise<{ hits: SignificantEvent[] }> {
    const result = await runFindByIdEsqlQuery<RawEventRow>({
      esClient: this.clients.esClient,
      space: this.clients.space,
      index: EVENTS_DATA_STREAM,
      idField: FIELD_EVENT_UUID,
      idValue: id,
    });
    return { hits: result.hits.map(decodeSeverity) };
  }

  async findByEventId(eventId: string): Promise<{ hits: SignificantEvent[] }> {
    const result = await runFindByIdEsqlQuery<RawEventRow>({
      esClient: this.clients.esClient,
      space: this.clients.space,
      index: EVENTS_DATA_STREAM,
      idField: FIELD_EVENT_ID,
      idValue: eventId,
    });
    return { hits: result.hits.map(decodeSeverity) };
  }

  async findLatestByEventIds(eventIds: string[]): Promise<Map<string, SignificantEvent>> {
    if (!eventIds.length) return new Map();
    const idLiterals = eventIds.map((s) => esql.str(s));
    const where = esql.exp`${esql.col(FIELD_EVENT_ID)} IN (${idLiterals})`;
    const { hits } = await runPaginatedLatestSourceEsqlQuery<RawEventRow>({
      esClient: this.clients.esClient,
      space: this.clients.space,
      options: { perPage: eventIds.length },
      index: EVENTS_DATA_STREAM,
      where,
      groupBy: FIELD_EVENT_ID,
    });
    const map = new Map<string, SignificantEvent>();
    for (const event of hits) {
      if (event.event_id) map.set(event.event_id, decodeSeverity(event));
    }
    return map;
  }
}
