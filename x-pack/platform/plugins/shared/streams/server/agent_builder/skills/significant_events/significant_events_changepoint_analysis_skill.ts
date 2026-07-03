/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import description from './significant_events_changepoint_analysis.description.text';
import content from './significant_events_changepoint_analysis.skill.md.text';
import changeTypeSemantics from './tables/change_type_semantics.md.text';

export const SIGNIFICANT_EVENTS_CHANGEPOINT_ANALYSIS_SKILL_ID =
  'significant-events-changepoint-analysis' as const;

export const significantEventsChangepointAnalysisSkill = defineSkillType({
  id: SIGNIFICANT_EVENTS_CHANGEPOINT_ANALYSIS_SKILL_ID,
  name: 'significant-events-changepoint-analysis',
  basePath: 'skills/platform/streams',
  description,
  content,
  referencedContent: [
    {
      name: 'change_type_semantics',
      relativePath: './tables',
      content: changeTypeSemantics,
    },
  ],
});
