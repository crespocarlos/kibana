/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { MAX_STREAM_NAME_LENGTH } from '@kbn/streams-schema';
import { sigEventBaseSchema } from '../common_schemas';
import { MAX_ID_LENGTH, MAX_RULE_NAME_LENGTH, MAX_TEXT_LENGTH } from '../constants';

const discoveryDetectionSchema = z.object({
  detection_id: z.string().max(MAX_ID_LENGTH).optional(),
  rule_name: z.string().max(MAX_RULE_NAME_LENGTH).optional(),
  rule_uuid: z.string().max(MAX_ID_LENGTH).optional(),
  stream_name: z.string().max(MAX_STREAM_NAME_LENGTH).optional(),
  change_point_type: z
    .string()
    .max(MAX_ID_LENGTH)
    .optional()
    .describe(
      'Change point type detected by the alerting rule. ' +
        '"spike" = Sudden increase in alert volume | Load surge, cascading failure, noisy rule. **Escalation.**; ' +
        '"dip" = Sudden decrease in alert volume | Service down (no data to alert on), rule disabled, data pipeline failure. **Escalation** — a drop to silence usually means the service went DOWN, not that it recovered. ' +
        '"step_change" = Sustained level shift | Config change, new deployment, capacity change. **Direction decides:** a shift up is an escalation; a shift back down toward low volume is a recovery.sustained level shift (config change, new deployment, capacity change); ' +
        '"trend_change" = Gradual directional shift | Growing workload, degrading performance, slow leak. **Direction decides:** an upward trend is an escalation; a downward trend toward low volume is a recovery.' +
        '"distribution_change" = Overall distribution shifted | Mixed traffic pattern change, deployment rollout. Escalation unless the shift is clearly back toward baseline.' +
        '"non_stationary" = No discrete change point, but not stationary | Gradual drift, chronic instability — weak signal. ' +
        '"stationary" = The alert rate is flat — no recent change up or down | Steady state. Steady is **not** benign: a stationary rule can be an ongoing failure holding a flat rate. Confirm with a query (signature query if no exact-match KI) and score severity from the **evidence and user impact**, never from the shape or the raw `alert_count`. When observed **after a prior escalation** on the same rule, treat as candidate recovery (confirm with a recovery-lens query).'
    ),
  p_value: z
    .number()
    .optional()
    .describe(
      'Statistical p_value of the change point detection. Lower values indicate stronger signal. ' +
        '≤0.05: credible signal — proceed with full investigation. ' +
        '0.05–0.10: weak signal — require KI backing or confirming failure rows before escalating. ' +
        '>0.10: low credibility — likely noise; do not promote without strong corroborating evidence.'
    ),
  event_count: z.number().optional(),
  alert_count: z.number().optional(),
});

export const discoverySchema = sigEventBaseSchema.extend({
  '@timestamp': z.iso.datetime(),
  kind: z
    .enum(['discovery', 'clearance', 'handled'])
    .describe(
      '"discovery" for an open investigation episode; ' +
        '"clearance" when the episode has recovered; ' +
        '"handled" to stamp the episode as fully processed after the significant event has been written.'
    ),
  discovery_id: z
    .string()
    .max(MAX_ID_LENGTH)
    .describe(
      'Unique ID for this discovery document version. Auto-generated when omitted. ' +
        'Required for "handled" kind to reference the discovery being stamped as fully processed.'
    ),
  discovered_at: z.iso.datetime().optional(),
  rule_names: z.array(z.string().max(MAX_RULE_NAME_LENGTH)).max(100),
  impact: z
    .string()
    .max(MAX_TEXT_LENGTH)
    .describe(
      'Human-readable summary of which users or systems are affected and what they cannot do.'
    ),
  detections: z.array(discoveryDetectionSchema),
  parent_discovery_id: z.string().max(MAX_ID_LENGTH).optional(),
  grouped_discovery_ids: z.array(z.string().max(MAX_ID_LENGTH)).optional(),
  grouping_rationale: z.string().max(MAX_TEXT_LENGTH).optional(),
  previous_discovery_id: z.string().max(MAX_ID_LENGTH).optional(),
  change_point_occurrence: z.string().max(MAX_ID_LENGTH).optional(),
  closed_by_execution_id: z.string().max(MAX_ID_LENGTH).optional(),
  processed: z.boolean(),
});

export type Discovery = z.infer<typeof discoverySchema>;
