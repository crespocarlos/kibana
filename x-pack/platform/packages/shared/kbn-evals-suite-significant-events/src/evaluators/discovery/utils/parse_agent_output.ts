/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformSignificantEventsTools } from '@kbn/agent-builder-common';
import type { ConverseStep } from '@kbn/evals';
import type { Discovery, SignificantEvent } from '@kbn/significant-events-schema';

interface DiscoveryWriteToolResult {
  data?: Pick<Discovery, 'discovery_slug'>;
}

interface EventsWriteToolResult {
  data?: { event_id?: string; written?: boolean };
}

const toolCallSteps = (steps: ConverseStep[], toolId: string) =>
  steps.filter((step) => step.type === 'tool_call' && step.tool_id === toolId && step.params);

/**
 * Extract discoveries from `discovery_write` tool call steps.
 */
export const extractDiscoveriesFromToolCall = (steps: ConverseStep[]): Discovery[] =>
  toolCallSteps(steps, platformSignificantEventsTools.discoveryWrite).map((step) => {
    const slug = (step.results?.[0] as DiscoveryWriteToolResult | undefined)?.data?.discovery_slug;
    return { ...step.params, ...(slug ? { discovery_slug: slug } : {}) } as Discovery;
  });

/**
 * Extract significant events from `events_write` tool call steps.
 * Merges `event_id` and `written` from the tool result so evaluators can inspect dedup outcomes.
 */
function extractJsonObject(message: string): Record<string, unknown> | undefined {
  if (!message) {
    return undefined;
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(message)) !== null) {
    const parsed = tryParseJsonObject(match[1]);
    if (parsed) {
      return parsed;
    }
  }

  return tryParseJsonObject(message);
}

function parseArrayProperty<T>(message: string, key: string): T[] {
  const obj = extractJsonObject(message);
  const value = obj?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Parse the discovery's `{ "discoveries": [...] }` message into `Discovery[]`. */
export function parseDiscoveries(message: string): Discovery[] {
  return parseArrayProperty<Discovery>(message, 'discoveries');
}

/** Parse the judge's `{ "significant_events": [...] }` message into `SignificantEvent[]`. */
export function parseSignificantEvents(message: string): SignificantEvent[] {
  return parseArrayProperty<SignificantEvent>(message, 'significant_events');
}
