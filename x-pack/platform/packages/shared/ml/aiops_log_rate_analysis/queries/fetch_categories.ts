/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { get, omit } from 'lodash';
import type { estypes } from '@elastic/elasticsearch';

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import { isPopulatedObject } from '@kbn/ml-is-populated-object';
import {
  createRandomSamplerWrapper,
  type RandomSamplerWrapper,
} from '@kbn/ml-random-sampler-utils';
import { createCategoryRequest } from '@kbn/aiops-log-pattern-analysis/create_category_request';
import type { Category, CategoriesAgg } from '@kbn/aiops-log-pattern-analysis/types';
import { isRequestAbortedError } from '@kbn/aiops-common/is_request_aborted_error';

import { RANDOM_SAMPLER_SEED } from '../constants';
import type { AiopsLogRateAnalysisSchema } from '../api/schema';

import { getQueryWithParams } from './get_query_with_params';

export const isMsearchResponseItemWithAggs = (
  arg: unknown
): arg is estypes.MsearchMultiSearchItem => isPopulatedObject(arg, ['aggregations']);

// Filter that includes docs from both the baseline and deviation time range.
export const getBaselineOrDeviationFilter = (
  params: AiopsLogRateAnalysisSchema
): estypes.QueryDslQueryContainer => {
  return {
    bool: {
      should: [
        {
          range: {
            [params.timeFieldName]: {
              gte: params.baselineMin,
              lte: params.baselineMax,
              format: 'epoch_millis',
            },
          },
        },
        {
          range: {
            [params.timeFieldName]: {
              gte: params.deviationMin,
              lte: params.deviationMax,
              format: 'epoch_millis',
            },
          },
        },
      ],
    },
  };
};

export const getCategoryRequest = (
  params: AiopsLogRateAnalysisSchema,
  fieldName: string,
  { wrap }: RandomSamplerWrapper
): estypes.SearchRequest => {
  const { index, timeFieldName } = params;

  const query = getQueryWithParams({
    params,
    // We're skipping the overall range query here since this
    // is covered by the filter which will match docs in both baseline
    // and deviation time range via `getBaselineOrDeviationFilter`.
    skipRangeQuery: true,
    filter: getBaselineOrDeviationFilter(params),
  });

  const { params: request } = createCategoryRequest(
    index,
    fieldName,
    timeFieldName,
    undefined,
    query,
    undefined,
    wrap,
    undefined,
    undefined,
    false,
    false
  );

  // In this case we're only interested in the aggregation which
  // `createCategoryRequest` returns, so we're re-applying the original
  // query we create via `getQueryWithParams` here.
  request.query = query;

  return request;
};

export interface FetchCategoriesResponse {
  categories: Category[];
}

export const fetchCategories = async (
  esClient: ElasticsearchClient,
  params: AiopsLogRateAnalysisSchema,
  fieldNames: string[],
  logger?: Logger,
  // The default value of 1 means no sampling will be used
  sampleProbability: number = 1,
  emitError?: (m: string) => void,
  abortSignal?: AbortSignal
): Promise<FetchCategoriesResponse[]> => {
  const randomSamplerWrapper = createRandomSamplerWrapper({
    probability: sampleProbability,
    seed: RANDOM_SAMPLER_SEED,
  });

  const result: FetchCategoriesResponse[] = [];

  const searches: estypes.MsearchRequestItem[] = fieldNames.flatMap((fieldName) => [
    { index: params.index },
    omit(getCategoryRequest(params, fieldName, randomSamplerWrapper), ['index']),
  ]);

  let mSearchResponse;

  try {
    mSearchResponse = await esClient.msearch({ searches }, { signal: abortSignal, maxRetries: 0 });
  } catch (error) {
    if (!isRequestAbortedError(error)) {
      if (logger) {
        logger.error(
          `Failed to fetch category aggregation for field names ${fieldNames.join()}, got: \n${JSON.stringify(
            error,
            null,
            2
          )}`
        );
      }

      if (emitError) {
        emitError(`Failed to fetch category aggregation for field names "${fieldNames.join()}".`);
      }
    }
    return result;
  }

  for (const [index, resp] of mSearchResponse.responses.entries()) {
    const fieldName = fieldNames[index];

    if (isMsearchResponseItemWithAggs(resp)) {
      const { aggregations } = resp;

      const {
        categories: { buckets },
      } = randomSamplerWrapper.unwrap(
        aggregations as unknown as Record<string, estypes.AggregationsAggregate>
      ) as CategoriesAgg;

      const categories: Category[] = buckets.map((b) => {
        const sparkline =
          b.sparkline === undefined
            ? {}
            : b.sparkline.buckets.reduce<Record<number, number>>((acc2, cur2) => {
                acc2[cur2.key] = cur2.doc_count;
                return acc2;
              }, {});

        return {
          key: b.key,
          count: b.doc_count,
          examples: b.examples.hits.hits.map((h) => get(h._source, fieldName)),
          sparkline,
          regex: b.regex,
        };
      });
      result.push({
        categories,
      });
    } else {
      if (logger) {
        logger.error(
          `Failed to fetch category aggregation for field "${fieldName}", got: \n${JSON.stringify(
            resp,
            null,
            2
          )}`
        );
      }

      if (emitError) {
        emitError(`Failed to fetch category aggregation for field "${fieldName}".`);
      }
    }
  }

  return result;
};
