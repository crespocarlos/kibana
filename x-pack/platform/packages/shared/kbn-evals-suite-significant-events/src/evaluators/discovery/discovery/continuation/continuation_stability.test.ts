/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { scoreContinuationRouting, scoreContinuationStability } from './continuation_stability';

describe('scoreContinuationStability', () => {
  it('scores a perfect single-event cascade as 1.0', () => {
    const result = scoreContinuationStability([
      { ruleName: 'r1', producedEventIds: ['event-1'] },
      { ruleName: 'r2', producedEventIds: ['event-1'] },
      { ruleName: 'r3', producedEventIds: ['event-1'] },
    ]);

    expect(result.score).toBe(1);
    expect(result.reusedCycles).toBe(2);
    expect(result.comparableCycles).toBe(2);
    expect(result.distinctEventIds).toBe(1);
  });

  it('scores event ID proliferation as 0', () => {
    const result = scoreContinuationStability([
      { ruleName: 'r1', producedEventIds: ['event-1'] },
      { ruleName: 'r2', producedEventIds: ['event-2'] },
      { ruleName: 'r3', producedEventIds: ['event-3'] },
    ]);

    expect(result.score).toBe(0);
    expect(result.reusedCycles).toBe(0);
    expect(result.comparableCycles).toBe(2);
    expect(result.distinctEventIds).toBe(3);
  });

  it('rewards a new event ID when the prior event is outside the lookup window', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-old'] },
      { producedEventIds: ['event-new'], expectReuse: false },
    ]);

    expect(result.score).toBe(1);
    expect(result.correctCycles).toBe(1);
    expect(result.reusedCycles).toBe(0);
  });

  it('penalizes reuse when the prior event is outside the lookup window', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-old'] },
      { producedEventIds: ['event-old'], expectReuse: false },
    ]);

    expect(result.score).toBe(0);
    expect(result.correctCycles).toBe(0);
    expect(result.reusedCycles).toBe(1);
  });

  it('gives partial credit when one follow-up reuses and one proliferates', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-1'] },
      { producedEventIds: ['event-1'] }, // reused
      { producedEventIds: ['event-2'] }, // new event ID
    ]);

    expect(result.score).toBe(0.5);
    expect(result.reusedCycles).toBe(1);
    expect(result.comparableCycles).toBe(2);
  });

  it('excludes a cycle that produced no discovery from comparableCycles, not as a reuse miss', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-1'] },
      { producedEventIds: [] }, // agent emitted nothing — different from a wrong event ID
      { producedEventIds: ['event-1'] },
    ]);

    expect(result.reusedCycles).toBe(1);
    expect(result.comparableCycles).toBe(1);
    expect(result.emptyCycles).toBe(1);
    expect(result.score).toBe(1);
  });

  it('stays gradable when only some post-establishing cycles are empty', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-1'] },
      { producedEventIds: [] },
      { producedEventIds: ['event-2'] }, // real miss — new event ID
    ]);

    expect(result.reusedCycles).toBe(0);
    expect(result.comparableCycles).toBe(1);
    expect(result.emptyCycles).toBe(1);
    expect(result.score).toBe(0);
  });

  it('returns null (not a misleadingly low score) when every follow-up cycle is empty', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-1'] },
      { producedEventIds: [] },
      { producedEventIds: [] },
    ]);

    expect(result.score).toBeNull();
    expect(result.comparableCycles).toBe(0);
    expect(result.emptyCycles).toBe(2);
  });

  it('skips leading empty cycles so the first producing cycle establishes the event', () => {
    const result = scoreContinuationStability([
      { producedEventIds: [] },
      { producedEventIds: ['event-1'] }, // establishing
      { producedEventIds: ['event-1'] }, // reused
    ]);

    expect(result.comparableCycles).toBe(1);
    expect(result.reusedCycles).toBe(1);
    expect(result.score).toBe(1);
  });

  it('returns null when there are fewer than two gradable cycles', () => {
    expect(scoreContinuationStability([]).score).toBeNull();
    expect(scoreContinuationStability([{ producedEventIds: ['event-1'] }]).score).toBeNull();
  });

  it('treats an event ID introduced mid-run and reused later as continuation of itself', () => {
    const result = scoreContinuationStability([
      { producedEventIds: ['event-1'] },
      { producedEventIds: ['event-2'] }, // new (miss)
      { producedEventIds: ['event-2'] }, // reuses event-2 (hit)
    ]);

    expect(result.reusedCycles).toBe(1);
    expect(result.comparableCycles).toBe(2);
    expect(result.score).toBe(0.5);
    expect(result.distinctEventIds).toBe(2);
  });
});

describe('scoreContinuationRouting', () => {
  it('credits an explicit established event_id as continuation', () => {
    const result = scoreContinuationRouting([
      { producedEventIds: ['event-1'] },
      { producedEventIds: ['event-1'], requestedEventIds: ['event-1'] },
    ]);

    expect(result.score).toBe(1);
    expect(result.reusedCycles).toBe(1);
  });

  it('does not mistake write-time deduplication for agent-selected continuation', () => {
    const result = scoreContinuationRouting([
      { producedEventIds: ['event-1'] },
      { producedEventIds: ['event-1'], requestedEventIds: [], expectReuse: false },
    ]);

    expect(result.score).toBe(1);
    expect(result.reusedCycles).toBe(0);
  });

  it('penalizes an omitted event_id when continuation is expected', () => {
    const result = scoreContinuationRouting([
      { producedEventIds: ['event-1'] },
      { producedEventIds: ['event-2'], requestedEventIds: [] },
    ]);

    expect(result.score).toBe(0);
    expect(result.reusedCycles).toBe(0);
  });
});
