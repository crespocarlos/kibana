/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import dateMath from '@kbn/datemath';
import {
  type BlastRadiusEntry,
  type CausalFeature,
  type Discovery,
  type SignalEntry,
} from '@kbn/significant-events-schema';
import type { DiscoveryClient } from '../../../lib/significant_events/discoveries';

export type DiscoveryWriteInput = Pick<
  Discovery,
  | 'kind'
  | 'title'
  | 'symptom_hypothesis'
  | 'summary'
  | 'severity'
  | 'stream_names'
  | 'confidence'
  | 'signals'
  | 'causal_features'
  | 'blast_radius'
  | 'previous_discovery_id'
  | 'workflow_execution_id'
  | 'conversation_id'
> & {
  /** Omit for new events — auto-generated (stream + rule UUIDs + random suffix; dedup uses `makeFingerprint`, not this id). Pass verbatim for continuation. */
  event_id?: Discovery['event_id'];
  /** Deduplication window (ES date math, e.g. `"now-24h"`). Not stored in the document. */
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
 * Returns true when any submitted detection signal has a different `change_point_type` than
 * the candidate discovery's signal for the same rule UUID. A changed change-point type means
 * the alerting engine observed a new pattern (e.g. spike → dip) and the write represents a
 * different operational state — it must not be suppressed as a duplicate.
 */
const hasChangedChangePointType = (
  submitted: SignalEntry[] | undefined,
  candidate: Discovery
): boolean => {
  const submittedDetections = (submitted ?? []).filter(
    (s): s is Extract<SignalEntry, { type: 'detection' }> => s.type === 'detection'
  );
  const candidateByRule = new Map(
    (candidate.signals ?? [])
      .filter((s): s is Extract<SignalEntry, { type: 'detection' }> => s.type === 'detection')
      .map((s) => [s.metadata.rule_uuid, s])
  );

  return submittedDetections.some((s) => {
    const existing = candidateByRule.get(s.metadata.rule_uuid);
    if (!existing) return false;
    return s.metadata.change_point_type !== existing.metadata.change_point_type;
  });
};

/**
 * Per-incident event id: a hash of the primary stream name plus every detection rule's
 * `rule_uuid` and a random UUID8 suffix. The suffix keeps each new incident instance unique so
 * resolved incidents and new ones for the same rules are treated as separate events in the UI.
 * Dedup uses `makeFingerprint` (stream + rules only, no suffix) rather than this id.
 */
export const generateEventId = (streamNames: string[], ruleUuids: string[]): string => {
  const suffix = uuidv4().replace(/-/g, '').slice(0, 8);
  const primaryStream = [...streamNames].sort()[0] ?? 'unknown';
  const basis = [primaryStream, ...[...ruleUuids].sort(), suffix].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
};

export const makeFingerprint = (streamNames: string[], ruleUuids: string[]): string => {
  const primaryStream = [...streamNames].sort()[0] ?? 'unknown';
  return [primaryStream, ...[...ruleUuids].sort()].join('|');
};

/**
 * Parses past-relative ES date math expressions into a millisecond offset.
 * Returns `undefined` for unrecognised expressions — callers should skip
 * dedup rather than silently falling back to a wrong window.
 */
const isDateMathExpression = (value: string): boolean => {
  return value.startsWith('now') || value.includes('||');
};

const parseDateMathToMs = (expr: string): number | undefined => {
  if (!isDateMathExpression(expr)) {
    return undefined;
  }

  const now = new Date();
  const parsed = dateMath.parse(expr, { forceNow: now });
  return parsed?.isValid() ? now.getTime() - parsed.valueOf() : undefined;
};

/**
 * Merges signals from prior discovery documents with the submitted signals, keeping the
 * latest per `metadata.rule_uuid` for detection-type signals. Prior-only rules are carried
 * forward; submitted rules win on equal-timestamp ties.
 */
const mergeLatestByKey = <T>(
  batches: Array<{ timestamp: string; values: T[] }>,
  getKey: (value: T) => string | undefined
): T[] => {
  const latest = new Map<string, { timestamp: string; value: T }>();

  for (const { timestamp, values } of batches) {
    for (const value of values) {
      const key = getKey(value);
      if (key === undefined) continue;
      const existing = latest.get(key);
      if (existing === undefined || timestamp >= existing.timestamp) {
        latest.set(key, { timestamp, value });
      }
    }
  }

  return [...latest.values()].map(({ value }) => value);
};

export const mergeSignalsLatestPerRule = (
  priorDocs: Array<Pick<Discovery, '@timestamp' | 'signals'>>,
  submitted: SignalEntry[],
  submittedTimestamp: string
): SignalEntry[] =>
  mergeLatestByKey(
    [
      ...priorDocs.map((doc) => ({
        timestamp: doc['@timestamp'],
        values: doc.signals ?? [],
      })),
      { timestamp: submittedTimestamp, values: submitted },
    ],
    (signal) => (signal.type === 'detection' ? signal.metadata?.rule_uuid ?? undefined : undefined)
  );

type EpisodeContextSource = Pick<Discovery, '@timestamp'> &
  Partial<Pick<Discovery, 'stream_names' | 'causal_features' | 'blast_radius'>>;

/**
 * Accumulates topology observed during an episode. The latest entry for a feature wins.
 * When the same feature_id appears in both arrays in any document, causal wins.
 */
export const mergeEpisodeContext = (
  priorDocs: EpisodeContextSource[],
  submitted: Omit<EpisodeContextSource, '@timestamp'> & {
    stream_names: Discovery['stream_names'];
  },
  submittedTimestamp: string
): { streamNames: string[]; causalFeatures: CausalFeature[]; blastRadius: BlastRadiusEntry[] } => {
  const contexts: EpisodeContextSource[] = [
    ...priorDocs,
    { ...submitted, '@timestamp': submittedTimestamp },
  ];

  const streamNames = new Set(contexts.flatMap((ctx) => ctx.stream_names ?? []));
  const causal = new Map<string, { timestamp: string; entry: CausalFeature }>();
  const blast = new Map<string, { timestamp: string; entry: BlastRadiusEntry }>();

  for (const ctx of contexts) {
    const ts = ctx['@timestamp'];
    for (const entry of ctx.blast_radius ?? []) {
      const existing = blast.get(entry.feature_id);
      if (!existing || ts >= existing.timestamp)
        blast.set(entry.feature_id, { timestamp: ts, entry });
    }
    for (const entry of ctx.causal_features ?? []) {
      blast.delete(entry.feature_id);
      const existing = causal.get(entry.feature_id);
      if (!existing || ts >= existing.timestamp)
        causal.set(entry.feature_id, { timestamp: ts, entry });
    }
  }

  for (const id of causal.keys()) blast.delete(id);

  const byFeatureId = (
    a: { entry: { feature_id: string } },
    b: { entry: { feature_id: string } }
  ) => a.entry.feature_id.localeCompare(b.entry.feature_id);

  return {
    streamNames: [...streamNames].sort(),
    causalFeatures: [...causal.values()].sort(byFeatureId).map(({ entry }) => entry),
    blastRadius: [...blast.values()].sort(byFeatureId).map(({ entry }) => entry),
  };
};

const findDuplicateDiscovery = async ({
  discoveryClient,
  streamNames,
  signals,
  dedupWindow,
  kind,
  isExplicitEventId,
}: {
  discoveryClient: DiscoveryClient;
  streamNames: string[];
  signals: SignalEntry[] | undefined;
  dedupWindow: string | undefined;
  kind: Discovery['kind'];
  isExplicitEventId: boolean;
}): Promise<Discovery | undefined> => {
  const windowMs = dedupWindow ? parseDateMathToMs(dedupWindow) : undefined;
  // Skip dedup for continuations (explicit event_id), handled stamps, clearances, or unrecognised windows.
  if (isExplicitEventId || kind === 'handled' || kind === 'clearance' || windowMs === undefined) {
    return undefined;
  }

  const cutoffIso = new Date(Date.now() - windowMs).toISOString();
  const fingerprint = makeFingerprint(streamNames, extractRuleUuids(signals));
  // Scan recent active discoveries and match on stream+rules fingerprint in memory. ES|QL `IN`
  // does not perform membership checks on multivalued keyword fields such as `stream_names`.
  // Uses findLatest (grouped by event_id, excludes handled) so only the latest doc per incident
  // is considered — prevents stale resolved incidents from blocking new ones.
  const { hits } = await discoveryClient.findLatest({ from: cutoffIso });
  const candidate = hits.find(
    (h) =>
      h.kind === 'discovery' &&
      makeFingerprint(h.stream_names ?? [], extractRuleUuids(h.signals)) === fingerprint
  );

  if (!candidate) return undefined;
  if (hasChangedChangePointType(signals, candidate)) return undefined;
  return candidate;
};

const prepareSnapshot = async ({
  discoveryClient,
  input,
  isExplicitEventId,
  timestamp,
}: {
  discoveryClient: DiscoveryClient;
  input: DiscoveryWriteInput & { event_id: string };
  isExplicitEventId: boolean;
  timestamp: string;
}): Promise<{
  signals: SignalEntry[];
  streamNames: string[];
  causalFeatures: CausalFeature[];
  blastRadius: BlastRadiusEntry[];
}> => {
  if (!isExplicitEventId || input.kind === 'handled') {
    return {
      signals: input.signals ?? [],
      streamNames: input.stream_names,
      causalFeatures: input.causal_features ?? [],
      blastRadius: input.blast_radius ?? [],
    };
  }

  const { hits: priorDocs } = await discoveryClient.findByEventId(input.event_id);
  // Exclude handled stamps — the old findStateBySlug path filtered these out so processed
  // cycles do not carry their detection signals into a fresh continuation write.
  const stateDocs = priorDocs.filter((doc) => doc.kind !== 'handled');
  return {
    signals: mergeSignalsLatestPerRule(stateDocs, input.signals ?? [], timestamp),
    ...mergeEpisodeContext(stateDocs, input, timestamp),
  };
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
  };

  const isExplicitEventId = Boolean(event_id);

  const duplicate = await findDuplicateDiscovery({
    discoveryClient,
    streamNames: rest.stream_names,
    signals: rest.signals,
    dedupWindow,
    kind: rest.kind,
    isExplicitEventId,
  });
  if (duplicate) {
    return {
      discovery_id: duplicate.discovery_id,
      event_id: duplicate.event_id ?? resolvedEventId,
      kind: discoveryInput.kind,
      written: false,
      skipped: true,
      reason: 'duplicate_within_window',
      existing_discovery_id: duplicate.discovery_id,
    };
  }

  const discoveryId = uuidv4();

  const timestamp = new Date().toISOString();
  const snapshot = await prepareSnapshot({
    discoveryClient,
    input: { ...discoveryInput, event_id: resolvedEventId },
    isExplicitEventId,
    timestamp,
  });

  await discoveryClient.bulkCreate(
    [
      {
        ...discoveryInput,
        '@timestamp': timestamp,
        discovered_at: discoveryInput.kind === 'discovery' ? timestamp : undefined,
        signals: snapshot.signals,
        stream_names: snapshot.streamNames,
        causal_features: snapshot.causalFeatures,
        blast_radius: snapshot.blastRadius,
        discovery_id: discoveryId,
        severity: discoveryInput.severity,
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
