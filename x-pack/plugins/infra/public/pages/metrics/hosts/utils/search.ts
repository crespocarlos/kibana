/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { filter, map } from 'rxjs/operators';
import { lastValueFrom } from 'rxjs';
import { isCompleteResponse } from '@kbn/data-plugin/public';
import { CreateAggConfigParams } from '@kbn/data-plugin/common';
import { RequestAdapter } from '@kbn/inspector-plugin/common';
import { CoreStart } from '@kbn/core/public';
import { DataView } from '@kbn/data-views-plugin/public';
import {
  MetricsUIAggregation,
  SnapshotMetricType,
} from '../../../../../common/inventory_models/types';
import { metrics } from '../../../../../common/inventory_models/host/metrics';
import { InfraClientStartDeps } from '../../../../types';

/**
 * Requests the documents for Discover. This will return a promise that will resolve
 * with the documents.
 */

const HOST_TABLE_METRICS: Array<{ type: SnapshotMetricType }> = [
  { type: 'rx' },
  { type: 'tx' },
  { type: 'memory' },
  { type: 'cpuCores' },
  { type: 'diskLatency' },
  { type: 'memoryTotal' },
];

export const fetchDocuments = async (
  dataView: DataView,
  { data }: Partial<CoreStart> & InfraClientStartDeps
): Promise<any> => {
  const searchSource = await data.search.searchSource.create();
  const abortController = new AbortController();

  searchSource
    .setField('index', dataView)
    .setField('size', 0)
    .setField('trackTotalHits', false)
    .setField('version', true);

  const aggDef: CreateAggConfigParams[] = [];
  aggDef.push({
    type: 'terms',
    schema: 'segment',
    params: {
      field: 'host.name',
      size: 100,
      order: 'asc',
    },
  });

  const metricsConfig = HOST_TABLE_METRICS.reduce(
    (acc, curr) => ({ ...acc, ...metrics.snapshot[curr.type] }),
    {} as MetricsUIAggregation
  );

  const test = Object.entries(metricsConfig).flatMap(([id, aggs]) => {
    const isFilteredMetric = Object.entries(aggs).some(([type, _]) => type === 'filter');
    if (isFilteredMetric) {
      return {
        id,
        name: id,
        schema: 'metric',
        type: 'filtered_metric',
        params: {
          customBucket: {
            type: 'filter',
            params: {
              filter: { language: 'kuery', query: `${(aggs as any).filter.exists.field}: *` },
            },
          },
          customMetric: {
            type: 'max',
            id: 'period',
            name: id,
            params: {
              field: 'metricset.period',
            },
          },
        },
      } as CreateAggConfigParams;
    }

    const isBucketScript = Object.entries(aggs).some(([type, _]) => type === 'bucket_script');
    if (isBucketScript) {
      return {
        id,
        schema: 'metric',
        type: 'bucket_script',
        params: {
          ...(aggs as any).bucket_script,
        },
      } as CreateAggConfigParams;
    }

    const r = Object.entries(aggs).map(([type, params]) => {
      return { id, schema: 'metric', type, params } as CreateAggConfigParams;
    }, [] as CreateAggConfigParams[]);
    return r;
  });

  const ac = data.search.aggs.createAggConfigs(dataView, [...aggDef, ...test]);
  searchSource.setField('aggs', ac);

  const executionContext = {
    description: 'fetch documents',
  };

  const fetch$ = searchSource
    .fetch$({
      abortSignal: abortController.signal,
      sessionId: data.search.session.getSessionId(),
      inspector: {
        adapter: new RequestAdapter(),
        title: 'Example App Inspector!',
        id: 'greatest-example-app-inspector',
        description: 'Use the `description` field for more info about the inspector.',
      },
      executionContext,
    })
    .pipe(
      filter((res) => isCompleteResponse(res)),
      map((res) => {
        return res.rawResponse;
      })
    );

  return lastValueFrom(fetch$).then((records) => ({ records }));
};
