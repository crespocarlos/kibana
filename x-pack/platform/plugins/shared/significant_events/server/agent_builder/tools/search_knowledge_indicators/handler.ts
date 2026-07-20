/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { searchKnowledgeIndicators } from '@kbn/streams-ai';
import type {
  SearchKnowledgeIndicatorsInput,
  SearchKnowledgeIndicatorsOutput,
} from '@kbn/streams-ai';
import type { Logger } from '@kbn/core/server';
import type { StreamsClient } from '@kbn/streams-plugin/server';
import type {
  KnowledgeIndicatorClient,
  RuleUnbackedFilter,
} from '../../../lib/knowledge_indicators';

export async function searchKnowledgeIndicatorsToolHandler({
  streamsClient,
  kiClient,
  logger,
  params,
}: {
  streamsClient: StreamsClient;
  kiClient: KnowledgeIndicatorClient;
  logger: Logger;
  params: SearchKnowledgeIndicatorsInput;
}): Promise<SearchKnowledgeIndicatorsOutput> {
  return await searchKnowledgeIndicators({
    params,
    onFeatureFetchError: (streamName, error) => {
      const errorMessage =
        error instanceof Error ? error.stack || error.message : String(error ?? 'Unknown error');
      logger.warn(
        `ki_search: failed to fetch features for stream "${streamName}": ${errorMessage}`
      );
    },
    getStreamNames: async () => {
      const streams = await streamsClient.listStreams();
      return streams.map((stream) => stream.name);
    },
    getFeatures: async (streamName, { searchText, featureTypes, featureIds }) => {
      const result = searchText
        ? await kiClient.findFeatures(streamName, searchText, { featureTypes, featureIds })
        : await kiClient.getFeatures(streamName, { type: featureTypes, featureIds });
      return result.hits;
    },
    getQueries: async (streamNames, { searchText, queryTypes, queryIds, ruleIds, ruleBacked }) => {
      const ruleUnbacked: RuleUnbackedFilter =
        ruleBacked === undefined ? 'include' : ruleBacked ? 'exclude' : 'only';
      const filters = {
        ruleUnbacked,
        queryTypes,
        queryIds,
        ruleIds,
      };

      // findQueries uses the default search mode (hybrid with silent keyword
      // fallback), giving the agent the best-available ranking.
      const links = searchText
        ? await kiClient.findQueries(streamNames, searchText, filters)
        : await kiClient.getQueryLinks(streamNames, filters);

      return links;
    },
  });
}
