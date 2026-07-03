/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { platformCoreTools } from '@kbn/agent-builder-common/tools';
import { STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID } from '../../tools/register_tools';
import description from './significant_events_ki_grounding.description.text';
import content from './significant_events_ki_grounding.skill.md.text';

export const SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID = 'significant-events-ki-grounding' as const;

export const significantEventsKIGroudingSkill = defineSkillType({
  id: SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID,
  name: 'significant-events-ki-grounding',
  basePath: 'skills/platform/streams',
  description,
  content,
  getRegistryTools: () => [
    STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID,
    platformCoreTools.executeEsql,
  ],
});
