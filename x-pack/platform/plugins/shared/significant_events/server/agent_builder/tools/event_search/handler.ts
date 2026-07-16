/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SignificantEvent, SignificantEventStatus } from '@kbn/significant-events-schema';
import {
  DEFAULT_EVENTS_SEARCH_FROM,
  DEFAULT_EVENTS_SEARCH_TO,
  type EventClient,
} from '../../../lib/significant_events/events';

export interface EventSearchInput {
  query?: string;
  page?: number;
  per_page?: number;
  stream_names?: string[];
  status?: SignificantEventStatus;
  rule_uuids?: string[];
  from?: string;
  to?: string;
}
export async function searchEventsToolHandler({
  eventClient,
  params,
}: {
  eventClient: EventClient;
  params: EventSearchInput;
}): Promise<{
  events: SignificantEvent[];
  page: number;
  per_page: number;
  total: number;
}> {
  const sharedParams = {
    page: params.page ?? 1,
    perPage: params.per_page ?? 100,
    search: params.query,
    stream: params.stream_names,
    from: params.from ?? DEFAULT_EVENTS_SEARCH_FROM,
    to: params.to ?? DEFAULT_EVENTS_SEARCH_TO,
  };

  const response =
    params.status !== undefined
      ? await eventClient.findLatestByCurrentStatePaginated({
          ...sharedParams,
          status: params.status ? [params.status] : undefined,
          ruleUuids: params.rule_uuids,
        })
      : await eventClient.findLatestPaginated(sharedParams);

  return {
    events: response.hits,
    page: response.page,
    per_page: response.perPage,
    total: response.total,
  };
}
