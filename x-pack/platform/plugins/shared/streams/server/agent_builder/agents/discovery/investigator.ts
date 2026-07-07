/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BuiltInAgentDefinition } from '@kbn/agent-builder-server/agents';
import { platformSignificantEventsTools, platformCoreTools } from '@kbn/agent-builder-common/tools';
import type { StreamsServer } from '../../../types';
import { getSignificantEventsAvailability } from '../../../routes/utils/assert_significant_events_access';
import instructions from './instructions/investigator.md.text';
import { SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID } from '../../skills/significant_events_ki_grounding';

export const SIGNIFICANT_EVENTS_INVESTIGATOR_AGENT_ID =
  'platform.sig_events.discovery.investigator';

export function createSignificantEventsInvestigatorAgent({
  server,
}: {
  server: StreamsServer;
}): BuiltInAgentDefinition {
  return {
    id: SIGNIFICANT_EVENTS_INVESTIGATOR_AGENT_ID,
    name: 'Significant Events Investigator',
    description:
      'Triages statistical detection signals across rules, correlates related detections into incident candidates using shared infrastructure, temporal proximity, and causal plausibility, and drafts structured discovery documents with root-cause hypotheses and supporting evidence.',
    labels: ['observability', 'streams', 'significant-events', 'discovery', 'investigator'],
    avatar_icon: 'logoElastic',
    availability: {
      cacheMode: 'space',
      handler: async (context) => {
        const availability = await getSignificantEventsAvailability({
          server,
          licensing: server.licensing,
          uiSettingsClient: context.uiSettings,
        });

        return availability.available
          ? { status: 'available' }
          : { status: 'unavailable', reason: availability.reason };
      },
    },
    configuration: {
      instructions,
      skill_ids: [SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID],
      // This agent's tool set is fully scoped by SIGNIFICANT_EVENTS_DISCOVERY_TOOL_IDS — the
      // generic platform_core_* tools are irrelevant to discovery and only add noise to tool selection.
      enable_elastic_capabilities: false,
      tools: [
        {
          tool_ids: [
            platformCoreTools.executeEsql,
            platformSignificantEventsTools.searchKnowledgeIndicators,
            platformSignificantEventsTools.searchEvent,
            platformSignificantEventsTools.discoveryWrite,
          ],
        },
      ],
    },
  } as const;
}
