/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Discovery, SignalEntry } from '@kbn/significant-events-schema';
import type { DiscoveryClient } from '../../../lib/significant_events/discoveries';
import { toSortableSeverity } from '../../../lib/significant_events/severity';

/**
 * `rule_uuid` from every `type: 'detection'` signal, deduplicated. Detection signals are the only
 * signal type with a `rule_uuid`; other signal types (once added) carry no rule identity to extract.
 */
const extractRuleUuids = (signals: SignalEntry[] | undefined): string[] => {
  const uuids = (signals ?? [])
    .filter((signal): signal is Extract<SignalEntry, { type: 'detection' }> =>
      Boolean(signal.type === 'detection' && signal.metadata.rule_uuid)
    )
    .map((signal) => signal.metadata.rule_uuid as string);
  return [...new Set(uuids)];
};

/**
 * Deterministic event id: a hash of the primary stream name plus every detection rule's
 * `rule_uuid`, sorted for order-independence. The same stream+rules combination always produces
 * the same id, so a rule firing again under identical conditions naturally lands on the same
 * event rather than requiring a separate fingerprint-matching dedup pass.
 */
export const generateEventId = (streamNames: string[], ruleUuids: string[]): string => {
  const primaryStream = [...streamNames].sort()[0] ?? 'unknown';
  const basis = [primaryStream, ...[...ruleUuids].sort()].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
};

/**
 * Input for writing a discovery document. Derived from the canonical Discovery schema.
 * `event_id` is optional — omit for new events and the handler generates one deterministically
 * from the stream names and detection rule uuids in `signals`. Pass verbatim for continuation
 * writes.
 * `discovery_id` and `dedup_window` are write-side controls not persisted to the stream.
 */
export type DiscoveryWriteInput = Pick<
  Discovery,
  | 'kind'
  | 'title'
  | 'summary'
  | 'stream_names'
  | 'severity'
  | 'confidence'
  | 'signals'
  | 'causal_features'
  | 'blast_radius'
  | 'previous_discovery_id'
  | 'workflow_execution_id'
  | 'conversation_id'
> & {
  /** Omit for new events — deterministically generated from stream names + rule uuids. Pass verbatim for continuation. */
  event_id?: Discovery['event_id'];
  /** Auto-generated when omitted. Required for `kind: 'handled'` to reference the target. */
  discovery_id?: Discovery['discovery_id'];
  /** Deduplication window (ES date math, e.g. `"now-1h"`). Not stored in the document. */
  dedup_window?: string;
};

export interface DiscoveryWriteResult {
  discovery_id: string;
  event_id: string;
  kind: Discovery['kind'];
  written: boolean;
  skipped?: boolean;
  reason?: string;
  existing_discovery_id?: string;
}

/**
 * Parses simple ES date math expressions like "now-1h", "now-30m", "now-7d"
 * into milliseconds offset. Only supports now-N{h|m|d|s} patterns.
 * Returns `undefined` for unrecognised expressions — callers should skip
 * dedup rather than silently falling back to a wrong window.
 */
export const parseDateMathToMs = (expr: string): number | undefined => {
  const match = expr.match(/^now-(\d+)([smhd])$/);
  if (!match) return undefined;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? 60 * 60 * 1000);
};

export async function discoveryWriteHandler({
  discoveryClient,
  input,
}: {
  discoveryClient: DiscoveryClient;
  input: DiscoveryWriteInput;
}): Promise<DiscoveryWriteResult> {
  const { dedup_window: dedupWindow, event_id, ...rest } = input;

  const resolvedEventId =
    event_id || generateEventId(rest.stream_names, extractRuleUuids(rest.signals));

  const discoveryInput = {
    ...rest,
    event_id: resolvedEventId,
    severity: toSortableSeverity(rest.severity),
  };

  // Deduplication: skip write if a non-handled discovery with this event_id exists within the window.
  // Unrecognised dedup_window expressions produce undefined — skip dedup rather than silently
  // falling back to an arbitrary window.
  const windowMs = dedupWindow != null ? parseDateMathToMs(dedupWindow) : undefined;
  if (discoveryInput.kind !== 'handled' && windowMs != null) {
    const existing = await discoveryClient.findByEventId(resolvedEventId);
    const cutoff = Date.now() - windowMs;
    const recent = existing.hits.find(
      (d) => d.kind !== 'handled' && new Date(d['@timestamp']).getTime() >= cutoff
    );
    if (recent) {
      return {
        discovery_id: recent.discovery_id,
        event_id: resolvedEventId,
        kind: discoveryInput.kind,
        written: false,
        skipped: true,
        reason: 'duplicate_within_window',
        existing_discovery_id: recent.discovery_id,
      };
    }
  }

  const now = new Date().toISOString();
  const discoveryId = discoveryInput.discovery_id || uuidv4();

  await discoveryClient.bulkCreate(
    [
      {
        '@timestamp': now,
        discovered_at: discoveryInput.kind === 'discovery' ? now : undefined,
        ...discoveryInput,
        discovery_id: discoveryId,
        processed: discoveryInput.kind === 'handled',
      },
    ],
    { throwOnFail: true }
  );

  return {
    discovery_id: discoveryId,
    event_id: resolvedEventId,
    kind: discoveryInput.kind,
    written: true,
  };
}
