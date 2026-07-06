/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformStreamsSigEventsTools } from '@kbn/agent-builder-common';
import type { ConverseStep } from '@kbn/evals';
import type { Discovery, SignificantEvent } from '@kbn/significant-events-schema';

interface DiscoveryWriteToolResult {
  data?: Pick<Discovery, 'discovery_slug'>;
}

const toolCallSteps = (steps: ConverseStep[], toolId: string) =>
  steps.filter((step) => step.type === 'tool_call' && step.tool_id === toolId && step.params);

/**
 * Extract discoveries from `discovery_write` tool call steps.
 */
export const extractDiscoveriesFromToolCall = (steps: ConverseStep[]): Discovery[] =>
  toolCallSteps(steps, platformStreamsSigEventsTools.discoveryWrite).map((step) => {
    const slug = (step.results?.[0] as DiscoveryWriteToolResult | undefined)?.data?.discovery_slug;
    return { ...step.params, ...(slug ? { discovery_slug: slug } : {}) } as Discovery;
  });

/**
 * Extract significant events from `events_write` tool call steps.
 */
export const extractSignificantEventsFromSteps = (steps: ConverseStep[]): SignificantEvent[] =>
  toolCallSteps(steps, platformStreamsSigEventsTools.eventsWrite).map(
    (step) => step.params as SignificantEvent
  );
