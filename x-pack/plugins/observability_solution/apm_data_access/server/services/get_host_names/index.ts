/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { estypes } from '@elastic/elasticsearch';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { HOST_NAME } from '@kbn/apm-utils/es_fields';
import {
  apmEnableContinuousRollups,
  apmEnableServiceMetrics,
} from '@kbn/observability-plugin/common';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { getPreferredBucketSizeAndDataSource } from '../../../common/utils/get_preferred_bucket_size_and_data_source';
import { ApmDocumentType } from '../../../common/document_type';
import { getDocumentSources } from '../get_document_sources';
import { ApmDataAccessClientParams } from '../get_client';

const MAX_LIMIT = 1000;
export interface ServicesHostNamesParams {
  query: estypes.QueryDslQueryContainer;
  kuery?: string;
  from: number;
  to: number;
  limit?: number;
}

const suitableTypes = [ApmDocumentType.TransactionMetric];

export function createGetHostNames({ apmEventClient, deps }: ApmDataAccessClientParams) {
  return async ({
    from: start,
    to: end,
    limit = MAX_LIMIT,
    query,
    kuery = '',
  }: ServicesHostNamesParams) => {
    const [enableContinuousRollups, enableServiceTransactionMetrics] = await Promise.all([
      deps.uiSettings.get<boolean>(apmEnableContinuousRollups),
      deps.uiSettings.get<boolean>(apmEnableServiceMetrics),
    ]);

    const documentSources = await getDocumentSources({
      apmEventClient,
      start,
      end,
      kuery,
      enableContinuousRollups,
      enableServiceTransactionMetrics,
    });

    const sourcesToUse = getPreferredBucketSizeAndDataSource({
      sources: documentSources.filter((s) => suitableTypes.includes(s.documentType)),
      bucketSizeInSeconds: getBucketSize({ start, end, numBuckets: 100 }).bucketSize,
    });

    const esResponse = await apmEventClient.search('get_apm_host_names', {
      apm: {
        sources: [
          {
            documentType: sourcesToUse.source.documentType,
            rollupInterval: sourcesToUse.source.rollupInterval,
          },
        ],
      },
      body: {
        track_total_hits: false,
        size: 0,
        query: {
          bool: {
            filter: [query, ...rangeQuery(start, end)],
          },
        },
        aggs: {
          hostNames: {
            terms: {
              field: HOST_NAME,
              size: limit,
            },
          },
        },
      },
    });

    return esResponse.aggregations?.hostNames.buckets.map((bucket) => bucket.key as string) ?? [];
  };
}
