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
import { discoverySchema } from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { StreamsServer } from '@kbn/streams-plugin/server/types';
import type { GetScopedClients } from '../../../routes/types';
import type { EbtTelemetryClient } from '../../../lib/telemetry/ebt';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { createSignificantEventsAvailability } from '../significant_events_availability';
import { discoveryWriteHandler } from './handler';

export const SIGNIFICANT_EVENTS_DISCOVERY_WRITE_TOOL_ID =
  platformSignificantEventsTools.discoveryWrite;

const discoveryWriteSchema = discoverySchema
  .pick({
    kind: true,
    discovery_id: true,
    event_id: true,
    title: true,
    symptom_hypothesis: true,
    summary: true,
    stream_names: true,
    severity: true,
    confidence: true,
    signals: true,
    causal_features: true,
    blast_radius: true,
    previous_discovery_id: true,
    workflow_execution_id: true,
    conversation_id: true,
  })
  .partial({ event_id: true, discovery_id: true })
  .extend({
    dedup_window: z
      .string()
      .default('now-24h')
      .describe(
        'Deduplication window as an ES date math expression (e.g. "now-24h"). Applies only to new events without an explicit event_id: if a kind:discovery document with the same primary stream and detection rule UUIDs already exists within this window, the write is skipped and the existing discovery_id is returned. Continuation writes (explicit event_id) are never deduped. Defaults to "now-24h".'
      ),
  });

export function createDiscoveryWriteTool({
  getScopedClients,
  server,
  logger,
  telemetry,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
  telemetry: EbtTelemetryClient;
}): StaticToolRegistration<typeof discoveryWriteSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof discoveryWriteSchema> = {
    id: SIGNIFICANT_EVENTS_DISCOVERY_WRITE_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Creates a new discovery.

      Use kind "discovery" or "clearance" to record an open investigation event. 
      Use kind "handled" to stamp the event as fully processed after the corresponding significant event has been written.
      
      A continuation with an explicit event_id carries prior signals, stream names, causal features, and blast radius forward. Submitted signals replace prior entries with the same metadata.rule_uuid; submitted topology replaces prior entries with the same feature_id.
    `,
    schema: discoveryWriteSchema,
    tags: ['streams', 'significant_events'],
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async (toolParams, context) => {
      const { request } = context;
      try {
        const { getDiscoveryClient, licensing } = await getScopedClients({
          request,
        });
        await assertSignificantEventsAccess({ server, licensing });

        const data = await discoveryWriteHandler({
          discoveryClient: getDiscoveryClient(),
          input: toolParams,
        });

        telemetry.trackAgentToolDiscoveryWrite({
          success: true,
          kind: toolParams.kind,
          event_id: data.event_id,
          stream_names: toolParams.stream_names,
          written: data.written,
        });

        return {
          results: [{ type: ToolResultType.other, data }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error running discovery_write: ${message}`);

        telemetry.trackAgentToolDiscoveryWrite({
          success: false,
          kind: toolParams.kind,
          event_id: toolParams.event_id ?? 'unknown',
          stream_names: toolParams.stream_names,
          written: false,
          error_message: message,
        });

        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: i18n.translate(
                  'xpack.significantEvents.agentBuilder.tools.discoveryWrite.errorMessage',
                  {
                    defaultMessage: 'Failed to write discovery document: {message}',
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
