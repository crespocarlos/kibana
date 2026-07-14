/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import dateMath from '@kbn/datemath';
import type { Discovery, SignalEntry } from '@kbn/significant-events-schema';
import type { DiscoveryClient } from '../../../lib/significant_events/discoveries';
import { toSortableSeverity } from '../../../lib/significant_events/severity';

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

export type DiscoveryDetection = Discovery['detections'][number];

export const mergeDetectionsLatestPerRule = (
  priorDocs: Array<Pick<Discovery, '@timestamp' | 'detections'>>,
  submitted: DiscoveryDetection[],
  submittedTimestamp: string
): DiscoveryDetection[] => {
  const latest = new Map<string, { timestamp: string; detection: DiscoveryDetection }>();

  // submitted considered last, so it wins equal-timestamp ties.
  const consider = (timestamp: string, detections: DiscoveryDetection[] = []) => {
    for (const detection of detections) {
      const existing = latest.get(detection.rule_uuid);
      if (existing === undefined || timestamp >= existing.timestamp) {
        latest.set(detection.rule_uuid, { timestamp, detection });
      }
    }
  };

  priorDocs.forEach((doc) => consider(doc['@timestamp'], doc.detections ?? []));
  consider(submittedTimestamp, submitted);

  return [...latest.values()].map((entry) => entry.detection);
};

export type DiscoveryEvidence = NonNullable<Discovery['evidences']>[number];

export const mergeEvidencesForCarriedRules = (
  priorDocs: Array<Pick<Discovery, '@timestamp' | 'evidences'>>,
  submitted: DiscoveryEvidence[]
): DiscoveryEvidence[] => {
  const merged: DiscoveryEvidence[] = [...submitted];
  const coveredRules = new Set(
    submitted.map((e) => e.rule_uuid).filter((id): id is string => Boolean(id))
  );

  const latestPerCarriedRule = new Map<
    string,
    { timestamp: string; evidence: DiscoveryEvidence }
  >();
  for (const doc of priorDocs) {
    for (const evidence of doc.evidences ?? []) {
      const ruleId = evidence.rule_uuid;
      if (!ruleId || coveredRules.has(ruleId)) continue; // keyless dropped; submitted wins
      const existing = latestPerCarriedRule.get(ruleId);
      if (existing === undefined || doc['@timestamp'] >= existing.timestamp) {
        latestPerCarriedRule.set(ruleId, { timestamp: doc['@timestamp'], evidence });
      }
    }
  }
  latestPerCarriedRule.forEach(({ evidence }) => merged.push(evidence));

  return merged;
};

const findDuplicateDiscovery = async ({
  discoveryClient,
  input,
  dedupWindow,
  isExplicitSlug,
}: {
  discoveryClient: DiscoveryClient;
  input: Pick<DiscoveryWriteInput, 'kind' | 'stream_names' | 'rule_names'>;
  dedupWindow: string | undefined;
  isExplicitSlug: boolean;
}): Promise<Discovery | undefined> => {
  const windowMs = dedupWindow ? parseDateMathToMs(dedupWindow) : undefined;
  if (
    isExplicitSlug ||
    input.kind === 'handled' ||
    input.kind === 'clearance' ||
    windowMs === undefined
  ) {
    return undefined;
  }

  const cutoffIso = new Date(Date.now() - windowMs).toISOString();
  const fingerprint = incidentFingerprint(input.kind, input.stream_names, input.rule_names);
  const { hits } = await discoveryClient.findLatest({ from: cutoffIso });

  return hits.find(
    (discovery) =>
      incidentFingerprint(
        discovery.kind,
        discovery.stream_names ?? [],
        discovery.rule_names ?? []
      ) === fingerprint
  );
};

const prepareSnapshotFields = async ({
  discoveryClient,
  input,
  isExplicitSlug,
  timestamp,
}: {
  discoveryClient: DiscoveryClient;
  input: DiscoveryWriteInput & { discovery_slug: string };
  isExplicitSlug: boolean;
  timestamp: string;
}): Promise<Pick<DiscoveryWriteInput, 'detections' | 'evidences'>> => {
  if (!isExplicitSlug || input.kind === 'handled') {
    return {
      detections: input.detections,
      evidences: input.evidences,
    };
  }

  const { hits: priorDocs } = await discoveryClient.findStateBySlug(input.discovery_slug);
  return {
    detections: mergeDetectionsLatestPerRule(priorDocs, input.detections ?? [], timestamp),
    evidences: mergeEvidencesForCarriedRules(priorDocs, input.evidences ?? []),
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
    severity: toSortableSeverity(rest.severity),
  };

  const isExplicitEventId = Boolean(event_id);

  const duplicate = await findDuplicateDiscovery({
    discoveryClient,
    input: rest,
    dedupWindow,
    isExplicitEventId,
  });
  if (duplicate) {
    return {
      discovery_id: duplicate.discovery_id,
      discovery_slug: duplicate.discovery_slug ?? resolvedSlug,
      kind: discoveryInput.kind,
      written: false,
      skipped: true,
      reason: 'duplicate_within_window',
      existing_discovery_id: duplicate.discovery_id,
    };
  }

  const discoveryId = uuidv4();

  const timestamp = new Date().toISOString();
  const { detections, evidences } = await prepareSnapshotFields({
    discoveryClient,
    input: discoveryInput,
    isExplicitSlug,
    timestamp,
  });

  await discoveryClient.bulkCreate(
    [
      {
        '@timestamp': timestamp,
        discovered_at: discoveryInput.kind === 'discovery' ? timestamp : undefined,
        ...discoveryInput,
        detections,
        evidences,
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
