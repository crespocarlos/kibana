/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { MAX_ID_LENGTH, MAX_RULE_NAME_LENGTH } from '../constants';

/**
 * The full set of change-point types a detection can carry. A detection is
 * modelled as an immutable change-point observation: `change_point_type` is an
 * observation of the metric's behaviour at a point in time — spike/dip/etc. and
 * the settling observations `stationary`/`non_stationary`. It is NOT a lifecycle
 * state: nothing translates a change-point type into open/active/quiet/recovered.
 * Lifecycle belongs to the alerting engine and is read from the alerts.
 */
export const CHANGE_POINT_TYPES = [
  'dip',
  'distribution_change',
  'non_stationary',
  'spike',
  'stationary',
  'step_change',
  'trend_change',
] as const;

export type ChangePointType = (typeof CHANGE_POINT_TYPES)[number];

/**
 * Detection — an immutable change-point observation. `change_point_type` and
 * `p_value` are top-level (no nested `detection_evidence`). `processed` is derived
 * at read time from the presence of a processed marker (see `processedMarkerSchema`)
 * and is never stored on the detection.
 */
export const detectionSchema = z.object({
  '@timestamp': z.iso.datetime({ offset: true }),
  detection_id: z.string().max(MAX_ID_LENGTH),
  rule_uuid: z.string().max(MAX_ID_LENGTH),
  rule_name: z.string().max(MAX_RULE_NAME_LENGTH),
  stream_name: z.string().max(MAX_ID_LENGTH).optional(),
  change_point_type: z.enum(CHANGE_POINT_TYPES),
  p_value: z.number().optional(),
  alert_count: z.number().optional(),
  alert_index: z.string().max(MAX_ID_LENGTH).optional(),
  workflow_execution_id: z.string().max(MAX_ID_LENGTH).optional(),
  // Derived at read time from processed-marker membership; never stored.
  processed: z.boolean(),
});

export type Detection = z.infer<typeof detectionSchema>;

/**
 * Processed marker — a minimal companion document written to the SAME data stream
 * to record that a detection has been ingested by the discovery pipeline. Distinguished
 * from a detection by field presence: detections carry `change_point_type`, markers carry
 * `processed_by`. `detection_id` references the exact detection the marker covers.
 */
export const processedMarkerSchema = z.object({
  '@timestamp': z.iso.datetime({ offset: true }),
  detection_id: z.string().max(MAX_ID_LENGTH),
  processed_by: z.string().max(MAX_ID_LENGTH),
});

export type ProcessedMarker = z.infer<typeof processedMarkerSchema>;
