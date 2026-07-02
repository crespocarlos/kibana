/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformSignificantEventsTools, ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import { i18n } from '@kbn/i18n';
import { significantEventStatusSchema } from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { GetScopedClients } from '../../../../routes/types';
import { assertSignificantEventsAccess } from '../../../../routes/utils/assert_significant_events_access';
import type { StreamsServer } from '../../../../types';
import { createSignificantEventsAvailability } from '../../significant_events_availability';
import { searchEventsToolHandler } from './handler';

export const SIGNIFICANT_EVENTS_SEARCH_TOOL_ID = platformStreamsSigEventsTools.searchEvent;

const searchEventsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.schema.query', {
        defaultMessage: 'Optional text search in event title.',
      })
    ),
  stream_name: z
    .string()
    .optional()
    .describe(
      i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.schema.streamName', {
        defaultMessage: 'Optional stream name to scope the search.',
      })
    ),
  status: z
    .array(significantEventStatusSchema)
    .optional()
    .describe(
      i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.schema.status', {
        defaultMessage: 'Optional event status filters.',
      })
    ),
  page: z.number().int().min(1).optional().default(1),
  per_page: z.number().int().min(1).max(100).optional().default(20),
  include_episodes: z
    .boolean()
    .optional()
    .describe(
      i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.schema.includeEpisodes', {
        defaultMessage:
          'When true, also returns open discovery documents linked to the matched events. ' +
          'Use this for episode continuation checks in the discovery workflow.',
      })
    ),
});

export function createSearchEventsTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof searchEventsSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof searchEventsSchema> = {
    id: SIGNIFICANT_EVENTS_SEARCH_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      ${i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.description.line1', {
        defaultMessage: 'Search significant events across all streams or a specific stream.',
      })}

      ${i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.description.line2', {
        defaultMessage:
          'Use this before creating or updating events to understand current event state.',
      })}

      ${i18n.translate('xpack.streams.agentBuilder.tools.eventSearch.description.line3', {
        defaultMessage:
          'Set include_episodes: true to also fetch open discovery documents for the matched events, ' +
          'enabling deduplication and episode continuation in the discovery workflow.',
      })}
    `,
    schema: searchEventsSchema,
    tags: ['streams', 'significant_events'],
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async (toolParams, context) => {
      const { request } = context;

      try {
        const { getEventClient, getDiscoveryClient, licensing, uiSettingsClient } =
          await getScopedClients({ request });
        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

        const data = await searchEventsToolHandler({
          eventClient: getEventClient(),
          discoveryClient: toolParams.include_episodes ? getDiscoveryClient() : undefined,
          params: toolParams,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error running event_search: ${message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: i18n.translate(
                  'xpack.streams.agentBuilder.tools.eventSearch.errorMessage',
                  {
                    defaultMessage: 'Failed to search significant events: {message}',
                    values: { message },
                  }
                ),
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
