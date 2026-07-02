/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Discovery, SignificantEvent } from '@kbn/significant-events-schema';
import type { DiscoveryClient } from '../../../../lib/significant_events/discoveries';
import type { EventClient } from '../../../../lib/significant_events/events';

export async function searchEventsToolHandler({
  eventClient,
  discoveryClient,
  params,
}: {
  eventClient: EventClient;
  discoveryClient?: DiscoveryClient;
  params: {
    query?: string;
    stream_name?: string;
    status?: string[];
    page?: number;
    per_page?: number;
    include_episodes?: boolean;
  };
}): Promise<{
  events: SignificantEvent[];
  page: number;
  per_page: number;
  total: number;
  episodes?: Discovery[];
}> {
  const response = await eventClient.findLatestPaginated({
    page: params.page,
    perPage: params.per_page,
    search: params.query,
    stream: params.stream_name ? [params.stream_name] : undefined,
    status: params.status,
  });

  const result: {
    events: SignificantEvent[];
    page: number;
    per_page: number;
    total: number;
    episodes?: Discovery[];
  } = {
    events: response.hits,
    page: response.page,
    per_page: response.perPage,
    total: response.total,
  };

  if (params.include_episodes && discoveryClient && response.hits.length) {
    const slugs = [
      ...new Set(
        response.hits.map((e) => e.discovery_slug).filter((slug): slug is string => Boolean(slug))
      ),
    ];

    const allDiscoveries = await Promise.all(slugs.map((slug) => discoveryClient.findBySlug(slug)));

    result.episodes = allDiscoveries.flatMap((r) => r.hits).filter((d) => d.kind !== 'handled');
  }

  return result;
}
