/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformCoreTools, platformSignificantEventsTools } from '@kbn/agent-builder-common';
import { extractToolCallIds } from '../../utils/tool_usage';

const { executeEsql: TOOL_ID_EXECUTE_ESQL } = platformCoreTools;
const {
  searchKnowledgeIndicators: TOOL_ID_KI_SEARCH,
  searchEvent: TOOL_ID_EVENT_SEARCH,
  discoveryWrite: TOOL_ID_DISCOVERY_WRITE,
} = platformSignificantEventsTools;
import type { DiscoveryEvaluator } from '../../types';

export const createDiscoveryToolUsageEvaluator = (): DiscoveryEvaluator => ({
  name: 'trajectory',
  kind: 'CODE',
  evaluate: ({ input, output }) => {
    const detections = output.inputDetections ?? input.detections ?? [];

    const calledTools = new Set(extractToolCallIds(output.steps ?? []));

    // Empty batch — agent should return immediately with no tool calls.
    if (detections.length === 0) {
      const unexpectedCalls = calledTools.size;
      return Promise.resolve({
        score: unexpectedCalls === 0 ? 1 : 0,
        label: unexpectedCalls === 0 ? 'correct' : 'unexpected-tools',
        explanation:
          unexpectedCalls === 0
            ? 'Empty batch: no tool calls made as expected'
            : `Empty batch: agent made ${unexpectedCalls} unexpected tool call(s) instead of early-exiting`,
      });
    }

    const expected = [TOOL_ID_EVENT_SEARCH, TOOL_ID_KI_SEARCH, TOOL_ID_EXECUTE_ESQL];
    const missing = expected.filter((t) => !calledTools.has(t));
    const trajectoryScore = (expected.length - missing.length) / expected.length;

    if (!calledTools.has(TOOL_ID_DISCOVERY_WRITE)) {
      return Promise.resolve({
        score: 0,
        label: 'missing-discovery-write',
        explanation: 'discovery_write was not called — required to emit at least one discovery',
      });
    }

    // Graded score (0 / 0.5 / 1) keeps the per-tool signal for prompt tuning; a distinct label per
    // failure mode makes the miss attributable/aggregatable across an eval run (free-text explanation
    // is not).
    const label =
      missing.length === 0
        ? 'correct'
        : missing.length === expected.length
        ? 'missing-both'
        : !calledTools.has(TOOL_ID_KI_SEARCH)
        ? 'missing-ki-search'
        : 'missing-esql';

    return Promise.resolve({
      score,
      label,
      explanation:
        trajectoryScore === 1
          ? 'Correctly called all tools'
          : `Missing tools: ${missing.join(', ')}`,
    });
  },
});
