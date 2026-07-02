/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { platformCoreTools, platformStreamsSigEventsTools } from '@kbn/agent-builder-common/tools';
import { STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID } from '../../tools/register_tools';
import description from './significant_events_discovery.description.text';
import content from './significant_events_discovery.skill.md.text';

export const SIGNIFICANT_EVENTS_DISCOVERY_SKILL_ID = 'significant-events-discovery' as const;

export const significantEventsDiscoverySkill = defineSkillType({
  id: SIGNIFICANT_EVENTS_DISCOVERY_SKILL_ID,
  name: 'significant-events-discovery',
  basePath: 'skills/platform/streams',
  description,
  content,
  getRegistryTools: () => [
    STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID,
    platformCoreTools.executeEsql,
    platformStreamsSigEventsTools.searchEvent,
    platformStreamsSigEventsTools.discoveryWrite,
    platformStreamsSigEventsTools.eventsWrite,
  ],
});
