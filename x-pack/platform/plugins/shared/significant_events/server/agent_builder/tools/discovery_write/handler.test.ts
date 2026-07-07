/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { discoveryWriteHandler, generateEventId, parseDateMathToMs } from './handler';

const baseInput = {
  kind: 'discovery' as const,
  title: 'Checkout latency',
  summary: 'P99 latency breached SLO',
  stream_names: ['logs.checkout'],
  severity: 'high' as const,
  confidence: 0.8,
  signals: [],
};

describe('generateEventId', () => {
  it('is deterministic for the same stream names and rule uuids', () => {
    const a = generateEventId(['logs.checkout'], ['rule-uuid-1']);
    const b = generateEventId(['logs.checkout'], ['rule-uuid-1']);
    expect(a).toBe(b);
  });

  it('is independent of rule uuid order', () => {
    const a = generateEventId(['logs.checkout'], ['rule-uuid-1', 'rule-uuid-2']);
    const b = generateEventId(['logs.checkout'], ['rule-uuid-2', 'rule-uuid-1']);
    expect(a).toBe(b);
  });

  it('differs when the rule uuids differ', () => {
    expect(generateEventId(['logs.checkout'], ['rule-uuid-1'])).not.toBe(
      generateEventId(['logs.checkout'], ['rule-uuid-2'])
    );
  });

  it('differs when the stream names differ', () => {
    expect(generateEventId(['logs.checkout'], ['rule-uuid-1'])).not.toBe(
      generateEventId(['logs.payments'], ['rule-uuid-1'])
    );
  });

  it('falls back to "unknown" stream when stream_names is empty', () => {
    expect(generateEventId([], ['rule-uuid-1'])).toBe(
      generateEventId(['unknown'], ['rule-uuid-1'])
    );
  });
});

describe('parseDateMathToMs', () => {
  it('parses hours', () => expect(parseDateMathToMs('now-1h')).toBe(3600000));
  it('parses minutes', () => expect(parseDateMathToMs('now-30m')).toBe(1800000));
  it('parses seconds', () => expect(parseDateMathToMs('now-10s')).toBe(10000));
  it('parses days', () => expect(parseDateMathToMs('now-1d')).toBe(86400000));
  it('returns undefined for unrecognised expressions', () =>
    expect(parseDateMathToMs('invalid')).toBeUndefined());
});

describe('discoveryWriteHandler', () => {
  it('writes a new discovery with a deterministically generated event_id', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: baseInput,
    });

    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
    expect(result.event_id).toBe(generateEventId(baseInput.stream_names, []));
  });

  it('uses the provided event_id verbatim', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, event_id: 'checkout-write-api-connection-refused' },
    });

    expect(result.event_id).toBe('checkout-write-api-connection-refused');
  });

  it('derives event_id from detection rule uuids in signals', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const signals = [
      {
        type: 'detection' as const,
        description: 'Testing: rule fired. Found: 12 rows. Verdict: confirms.',
        metadata: { rule_uuid: 'rule-uuid-1' },
      },
    ];

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, signals },
    });

    expect(result.event_id).toBe(generateEventId(baseInput.stream_names, ['rule-uuid-1']));
  });

  it('skips write when a non-handled duplicate exists within the dedup window', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({
        hits: [
          {
            discovery_id: 'existing-disc-id',
            event_id: 'checkout-event-id',
            kind: 'discovery',
            '@timestamp': new Date().toISOString(),
          },
        ],
      }),
      bulkCreate: jest.fn(),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, event_id: 'checkout-event-id', dedup_window: 'now-1h' },
    });

    expect(discoveryClient.bulkCreate).not.toHaveBeenCalled();
    expect(result.written).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('duplicate_within_window');
    expect(result.existing_discovery_id).toBe('existing-disc-id');
  });

  it('does not skip when the existing hit is outside the dedup window', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({
        hits: [
          {
            discovery_id: 'existing-disc-id',
            event_id: 'checkout-event-id',
            kind: 'discovery',
            '@timestamp': new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, event_id: 'checkout-event-id', dedup_window: 'now-1h' },
    });

    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
  });

  it('does not skip when the existing hit is kind:handled', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({
        hits: [
          {
            discovery_id: 'existing-disc-id',
            event_id: 'checkout-event-id',
            kind: 'handled',
            '@timestamp': new Date().toISOString(),
          },
        ],
      }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, event_id: 'checkout-event-id', dedup_window: 'now-1h' },
    });

    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
  });

  it('skips dedup when dedup_window is unrecognised', async () => {
    const discoveryClient = {
      findByEventId: jest.fn(),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, event_id: 'checkout-event-id', dedup_window: 'invalid' },
    });

    expect(discoveryClient.findByEventId).not.toHaveBeenCalled();
    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
  });

  it('skips dedup check for kind:handled', async () => {
    const discoveryClient = {
      findByEventId: jest.fn(),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: {
        ...baseInput,
        kind: 'handled',
        event_id: 'checkout-event-id',
        dedup_window: 'now-1h',
      },
    });

    expect(discoveryClient.findByEventId).not.toHaveBeenCalled();
    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('generates a discovery_id when omitted, and reuses one when provided', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const generated = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: baseInput,
    });
    expect(generated.discovery_id).toHaveLength(36);

    const provided = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, discovery_id: 'explicit-discovery-id' },
    });
    expect(provided.discovery_id).toBe('explicit-discovery-id');
  });

  it('sets processed only for kind:handled', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, kind: 'handled', event_id: 'checkout-event-id' },
    });

    const [[documents]] = discoveryClient.bulkCreate.mock.calls;
    expect(documents[0].processed).toBe(true);
    expect(documents[0].discovered_at).toBeUndefined();
  });

  it('sets discovered_at only for kind:discovery', async () => {
    const discoveryClient = {
      findByEventId: jest.fn().mockResolvedValue({ hits: [] }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: baseInput,
    });

    const [[documents]] = discoveryClient.bulkCreate.mock.calls;
    expect(documents[0].discovered_at).toBeDefined();
    expect(documents[0].processed).toBe(false);
  });
});
