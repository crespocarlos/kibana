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
import {
  significantEventSchema,
  significantEventStatusSchema,
} from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { EbtTelemetryClient } from '../../../../lib/telemetry/ebt';
import type { GetScopedClients } from '../../../../routes/types';
import { assertSignificantEventsAccess } from '../../../../routes/utils/assert_significant_events_access';
import type { StreamsServer } from '../../../../types';
import { createSignificantEventsAvailability } from '../../significant_events_availability';
import { createEventToolHandler } from './handler';

export const SIGNIFICANT_EVENTS_CREATE_EVENT_TOOL_ID = platformStreamsSigEventsTools.createEvent;

const createEventSchema = significantEventSchema
  .pick({
    status: true,
    title: true,
    summary: true,
    root_cause: true,
    stream_names: true,
    criticality: true,
    confidence: true,
    recommendations: true,
  })
  .extend({
    status: significantEventStatusSchema.optional().describe(
      i18n.translate('xpack.streams.agentBuilder.tools.eventCreate.schema.status', {
        defaultMessage: 'Status for the new event.',
      })
    ),
    criticality: z.number().int().min(0).max(100),
    confidence: z.number().min(0).max(1),
  });

export function createEventTool({
  getScopedClients,
  server,
  logger,
  telemetry,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
  telemetry: EbtTelemetryClient;
}): StaticToolRegistration<typeof createEventSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof createEventSchema> = {
    id: SIGNIFICANT_EVENTS_CREATE_EVENT_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      ${i18n.translate('xpack.streams.agentBuilder.tools.eventCreate.description', {
        defaultMessage: 'Create a significant event for one or more streams.',
      })}
    `,
    schema: createEventSchema,
    tags: ['streams', 'significant_events'],
    confirmation: {
      askUser: 'always',
      getConfirmation: async ({ toolParams }) => ({
        title: i18n.translate('xpack.streams.agentBuilder.tools.eventCreate.confirmation.title', {
          defaultMessage: 'Create Significant Event',
        }),
        message: i18n.translate(
          'xpack.streams.agentBuilder.tools.eventCreate.confirmation.message',
          {
            defaultMessage: 'Create significant event "{title}" for streams: {streams}?',
            values: {
              title: toolParams.title,
              streams: toolParams.stream_names.join(', '),
            },
          }
        ),
        confirm_text: i18n.translate(
          'xpack.streams.agentBuilder.tools.eventCreate.confirmation.confirm',
          {
            defaultMessage: 'Create',
          }
        ),
        cancel_text: i18n.translate(
          'xpack.streams.agentBuilder.tools.eventCreate.confirmation.cancel',
          {
            defaultMessage: 'Cancel',
          }
        ),
      }),
    },
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async (toolParams, context) => {
      const { request } = context;
      try {
        const { getEventClient, licensing, uiSettingsClient } = await getScopedClients({ request });
        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

        const data = await createEventToolHandler({
          eventClient: getEventClient(),
          eventInput: toolParams,
        });

        telemetry.trackAgentToolEventCreate({
          success: true,
          stream_names: toolParams.stream_names,
        });

        return { results: [{ type: ToolResultType.other, data }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error running event_create: ${message}`);
        telemetry.trackAgentToolEventCreate({
          success: false,
          stream_names: toolParams.stream_names,
          error_message: message,
        });
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: i18n.translate(
                  'xpack.streams.agentBuilder.tools.eventCreate.errorMessage',
                  {
                    defaultMessage: 'Failed to create significant event: {message}',
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
