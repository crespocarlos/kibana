/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import {
  SIGNIFICANT_EVENTS_CREATE_EVENT_TOOL_ID,
  SIGNIFICANT_EVENTS_STATUS_UPDATE_TOOL_ID,
  SIGNIFICANT_EVENTS_SEARCH_TOOL_ID,
  STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID,
} from '../../tools/register_tools';
import description from './significant_events_management.description.text';
import content from './significant_events_management.skill.md.text';

export const sigEventsManagementSkill = defineSkillType({
  id: 'significant-events-management',
  name: 'significant-events-management',
  basePath: 'skills/platform/streams',
  description,
  content,
  getRegistryTools: () => [
    SIGNIFICANT_EVENTS_SEARCH_TOOL_ID,
    SIGNIFICANT_EVENTS_CREATE_EVENT_TOOL_ID,
    SIGNIFICANT_EVENTS_STATUS_UPDATE_TOOL_ID,
    STREAMS_SEARCH_KNOWLEDGE_INDICATORS_TOOL_ID,
  ],
});
