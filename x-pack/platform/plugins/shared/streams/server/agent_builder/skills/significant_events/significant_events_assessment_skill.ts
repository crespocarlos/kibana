/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import description from './significant_events_assessment.description.text';
import content from './significant_events_assessment.skill.md.text';
import sevTiers from './tables/sev_tiers.md.text';
import confidenceScale from './tables/confidence_scale.md.text';

export const SIGNIFICANT_EVENTS_ASSESSMENT_SKILL_ID = 'significant-events-assessment' as const;

export const significantEventsAssessmentSkill = defineSkillType({
  id: SIGNIFICANT_EVENTS_ASSESSMENT_SKILL_ID,
  name: 'significant-events-assessment',
  basePath: 'skills/platform/streams',
  description,
  content,
  referencedContent: [
    {
      name: 'sev_tiers',
      relativePath: './tables',
      content: sevTiers,
    },
    {
      name: 'confidence_scale',
      relativePath: './tables',
      content: confidenceScale,
    },
  ],
});
