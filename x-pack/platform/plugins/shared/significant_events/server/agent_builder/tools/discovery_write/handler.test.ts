/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { discoveryWriteHandler, generateDiscoverySlug, parseDateMathToMs } from './handler';

const baseInput = {
  kind: 'discovery' as const,
  title: 'Checkout latency',
  summary: 'P99 latency breached SLO',
  root_cause: 'Connection pool exhaustion',
  impact: 'high' as const,
  rule_names: ['high-latency-rule'],
  stream_names: ['logs.checkout'],
  criticality: 80,
  confidence: 0.8,
  detections: [],
  dependency_edges: [],
  infra_components: [],
  cause_kis: [],
  evidences: [],
};

describe('generateDiscoverySlug', () => {
  it('builds slug from stream last segment and rule name', () => {
    const slug = generateDiscoverySlug(['logs.checkout.service'], ['high latency rule']);
    expect(slug).toMatch(/^service__high-latency-rule-[a-f0-9]{8}$/);
  });

  it('falls back to "unknown" when arrays are empty', () => {
    const slug = generateDiscoverySlug([], []);
    expect(slug).toMatch(/^unknown__unknown-[a-f0-9]{8}$/);
  });

  it('truncates long rule names to 40 characters', () => {
    const longRule = 'a'.repeat(60);
    const slug = generateDiscoverySlug(['logs.a'], [longRule]);
    const rulePart = slug.split('__')[1].split('-').slice(0, -1).join('-');
    expect(rulePart.length).toBeLessThanOrEqual(40);
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
  it('writes a new discovery and returns a generated slug', async () => {
    const discoveryClient = {
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: baseInput,
    });

    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(discoveryClient.bulkCreate).toHaveBeenCalledWith(expect.any(Array), {
      throwOnFail: true,
    });
    expect(result.written).toBe(true);
    expect(result.discovery_slug).toMatch(/^checkout__high-latency-rule-[a-f0-9]{8}$/);
  });

  it('uses provided discovery_slug verbatim', async () => {
    const discoveryClient = {
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, discovery_slug: 'checkout__my-slug-abc12345' },
    });

    expect(result.discovery_slug).toBe('checkout__my-slug-abc12345');
  });

  it('skips write when duplicate exists within dedup window', async () => {
    const recentTimestamp = new Date(Date.now() - 1000).toISOString();
    const discoveryClient = {
      findBySlug: jest.fn().mockResolvedValue({
        hits: [
          {
            discovery_id: 'existing-disc-id',
            kind: 'discovery',
            '@timestamp': recentTimestamp,
          },
        ],
      }),
      bulkCreate: jest.fn(),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, discovery_slug: 'checkout__latency-abc12345', dedup_window: 'now-1h' },
    });

    expect(discoveryClient.bulkCreate).not.toHaveBeenCalled();
    expect(result.written).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('duplicate_within_window');
    expect(result.existing_discovery_id).toBe('existing-disc-id');
  });

  it('does not skip when duplicate is outside the dedup window', async () => {
    const oldTimestamp = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const discoveryClient = {
      findBySlug: jest.fn().mockResolvedValue({
        hits: [{ discovery_id: 'old-disc-id', kind: 'discovery', '@timestamp': oldTimestamp }],
      }),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: { ...baseInput, discovery_slug: 'checkout__latency-abc12345', dedup_window: 'now-1h' },
    });

    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
  });

  it('skips dedup when dedup_window is unrecognised', async () => {
    const discoveryClient = {
      findBySlug: jest.fn(),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    const result = await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: {
        ...baseInput,
        discovery_slug: 'checkout__latency-abc12345',
        dedup_window: 'invalid',
      },
    });

    expect(discoveryClient.findBySlug).not.toHaveBeenCalled();
    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(true);
  });

  it('skips dedup check for kind:handled', async () => {
    const discoveryClient = {
      findBySlug: jest.fn(),
      bulkCreate: jest.fn().mockResolvedValue(undefined),
    };

    await discoveryWriteHandler({
      discoveryClient: discoveryClient as never,
      input: {
        ...baseInput,
        kind: 'handled',
        discovery_slug: 'checkout__latency-abc12345',
        dedup_window: 'now-1h',
      },
    });

    expect(discoveryClient.findBySlug).not.toHaveBeenCalled();
    expect(discoveryClient.bulkCreate).toHaveBeenCalledTimes(1);
  });
});
