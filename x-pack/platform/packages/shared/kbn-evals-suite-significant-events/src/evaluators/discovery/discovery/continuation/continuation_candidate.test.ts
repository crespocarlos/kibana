/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { toSignificantEventSeed } from './continuation_candidate';

describe('toSignificantEventSeed', () => {
  it('stamps event_uuid and derives stream_names from signals', () => {
    const seed = toSignificantEventSeed({
      eventUuid: 'svc__cascade-aaaa1111-cycle-0',
      discovery: {
        event_id: 'svc__cascade-aaaa1111',
        summary: 'cascade',
        title: 'Cascade',
        confidence: 0.8,
        severity: 'critical',
        signals: [
          {
            type: 'detection',
            stream_name: 'logs-a',
            description: 'connection refused',
            metadata: { rule_name: 'r1', rule_uuid: 'u1', kind: 'detection' },
          },
          {
            type: 'detection',
            stream_name: 'logs-b',
            description: 'cache error',
            metadata: { rule_name: 'r2', rule_uuid: 'u2', kind: 'detection' },
          },
          // duplicate stream — should be de-duped
          {
            type: 'detection',
            stream_name: 'logs-a',
            description: 'pool init failed',
            metadata: { rule_name: 'r3', rule_uuid: 'u3', kind: 'detection' },
          },
        ],
      },
    });

    expect(seed.event_uuid).toBe('svc__cascade-aaaa1111-cycle-0');
    expect(seed.event_id).toBe('svc__cascade-aaaa1111');
    expect(seed.status).toBe('open');
    expect(seed.stream_names).toEqual(['logs-a', 'logs-b']);
    expect(seed.confidence).toBe(0.8);
    expect(seed.severity).toBe('critical');
  });

  it('falls back to event_uuid as event_id when event_id is missing', () => {
    const seed = toSignificantEventSeed({
      eventUuid: 'fallback-id',
      discovery: {},
    });

    expect(seed.event_id).toBe('fallback-id');
    expect(seed.stream_names).toEqual(['unknown']);
  });

  it('always sets status to open', () => {
    const seed = toSignificantEventSeed({
      eventUuid: 'e1',
      discovery: { event_id: 'svc__x' },
    });

    expect(seed.status).toBe('open');
  });
});
