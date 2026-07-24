/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import { type SignificantEvent } from '@kbn/significant-events-schema';
import type { EventClient } from '../../../lib/significant_events/events';
import {
  assertUniqueBulkWriteKeys,
  assertValidBulkWriteSize,
  createBulkWriteItemError,
  createBulkWriteOutcomeUnknownError,
  extractCreateResults,
  type CompactBulkError,
  toCompactBulkError,
} from '../bulk_write';

/**
 * Input for writing a significant event document. Derived from the canonical SignificantEvent
 * schema.
 *
 * `event_id` is optional. When absent (chat-initiated path), a synthetic ID is generated
 * (`agent-event-<uuid8>`) and the latest-version lookup is skipped.
 *
 * `conversation_id` is the only addition not in the base schema — passed through for traceability.
 */
export type EventsWriteInput = Pick<
  SignificantEvent,
  | 'discovery_id'
  | 'status'
  | 'stream_names'
  | 'title'
  | 'symptom_hypothesis'
  | 'summary'
  | 'severity'
  | 'confidence'
  | 'assessment_note'
  | 'signals'
  | 'causal_features'
  | 'blast_radius'
  | 'workflow_execution_id'
> & {
  /** Optional — generated as `agent-event-<uuid8>` when absent (chat-initiated path). */
  event_id?: string;
  /** Not in the base SignificantEvent schema — passed through for traceability. */
  conversation_id?: string;
};

export interface EventsWriteResult {
  index: number;
  event_uuid: string;
  event_id: string;
  status: SignificantEvent['status'];
  written: true;
}

export interface EventsWriteSkippedResult {
  index: number;
  event_id: string;
  status: SignificantEvent['status'];
  severity: SignificantEvent['severity'];
  written: false;
  skipped: true;
  reason: 'no_change';
}

export interface EventsWriteFailureResult {
  index: number;
  event_id: string;
  status: SignificantEvent['status'];
  written: false;
  reason: 'bulk_error';
  error: CompactBulkError;
}

export type EventsWriteBulkResult =
  | EventsWriteResult
  | EventsWriteSkippedResult
  | EventsWriteFailureResult;

/**
 * Versions a batch of significant events in one request while preserving input order in the
 * returned results. Transport or malformed-response failures leave the whole outcome unknown;
 * Elasticsearch item failures remain isolated to their corresponding results.
 */
export async function eventsWriteBulkHandler({
  eventClient,
  inputs,
}: {
  eventClient: EventClient;
  inputs: EventsWriteInput[];
}): Promise<EventsWriteBulkResult[]> {
  assertValidBulkWriteSize(inputs);
  assertUniqueBulkWriteKeys(
    inputs.flatMap((input, index) =>
      input.event_id === undefined ? [] : [{ index, key: input.event_id }]
    ),
    'event_id'
  );

  const explicitEventIds = inputs.flatMap((input) =>
    input.event_id === undefined ? [] : [input.event_id]
  );
  // Synthetic event IDs are always new. Only explicit IDs need a latest-version lookup for
  // previous_event_uuid and investigation lineage.
  const latestEvents =
    explicitEventIds.length === 0
      ? new Map<string, SignificantEvent>()
      : await eventClient.findLatestByEventIds(explicitEventIds);
  const timestamp = new Date().toISOString();
  const prepared = inputs.map((input, index) => {
    const eventId = input.event_id ?? `agent-event-${uuidv4().slice(0, 8)}`;
    const eventUuid = uuidv4();
    const latest = latestEvents.get(eventId);
    return {
      index,
      input,
      latest,
      eventId,
      eventUuid,
      status: input.status,
      document: {
        ...input,
        '@timestamp': timestamp,
        event_uuid: eventUuid,
        event_id: eventId,
        previous_event_uuid: latest?.event_uuid,
        // Carry investigation lineage forward so a re-open keeps investigations already attached
        // to the episode. Triage uses this to avoid re-investigating it. Status updates already
        // spread the latest document, and the UI attachment path writes this field directly.
        investigations: latest?.investigations,
        severity: input.severity,
      },
    };
  });

  const results: Array<EventsWriteBulkResult | undefined> = new Array(inputs.length);
  const itemsToCreate: typeof prepared = [];

  for (const item of prepared) {
    // Only deduplicate items with an explicit event_id — synthetic IDs are always new.
    if (item.input.event_id !== undefined) {
      if (
        item.latest !== undefined &&
        item.latest.status === item.input.status &&
        item.latest.severity === item.input.severity
      ) {
        results[item.index] = {
          index: item.index,
          event_id: item.eventId,
          status: item.input.status,
          severity: item.input.severity,
          written: false,
          skipped: true,
          reason: 'no_change',
        };
        continue;
      }
    }
    itemsToCreate.push(item);
  }

  if (itemsToCreate.length > 0) {
    let response;
    try {
      response = await eventClient.bulkCreate(
        itemsToCreate.map(({ document }) => document),
        // `wait_for` lets the immediate triage `_count` see the newly written event version.
        { throwOnFail: false, refresh: 'wait_for' }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Elasticsearch transport error';
      throw createBulkWriteOutcomeUnknownError(`Event bulk write outcome is unknown: ${message}`);
    }

    const createResults = extractCreateResults(response, itemsToCreate.length, 'Event');

    itemsToCreate.forEach(({ index, eventId, eventUuid, status }, responseIndex) => {
      const detail = createResults[responseIndex];
      results[index] = detail.error
        ? {
            index,
            event_id: eventId,
            status,
            written: false,
            reason: 'bulk_error',
            error: toCompactBulkError(detail),
          }
        : { index, event_uuid: eventUuid, event_id: eventId, status, written: true };
    });
  }

  const alignedResults: EventsWriteBulkResult[] = [];
  for (const result of results) {
    if (result === undefined) {
      throw createBulkWriteOutcomeUnknownError(
        'Event bulk results were not aligned with every input'
      );
    }
    alignedResults.push(result);
  }
  return alignedResults;
}

/**
 * Single-item adapter retained for callers such as `event_create` that require thrown item errors.
 * Returns without throwing when the write is skipped (`no_change`) — callers should check
 * `result.written` when the skipped outcome is relevant.
 */
export async function eventsWriteHandler({
  eventClient,
  input,
}: {
  eventClient: EventClient;
  input: EventsWriteInput;
}): Promise<EventsWriteResult | EventsWriteSkippedResult> {
  const [result] = await eventsWriteBulkHandler({ eventClient, inputs: [input] });
  if (result === undefined) {
    throw createBulkWriteOutcomeUnknownError('Event bulk write did not return a result');
  }
  if (!result.written) {
    if (result.reason === 'bulk_error') {
      throw createBulkWriteItemError(result.error);
    }
    return result;
  }
  return result;
}
