/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { generateShortId, generateLongId, generateLongIdWithSeed } from './generate_id';

// Mock the uuidv4 function to avoid generating random values
jest.mock('uuid', () => ({
  v4: jest.fn(() => '123e4567e89b12d3a456426655440000'),
}));

describe('ID Generation Tests', () => {
  it('should generate a short ID of the correct length', () => {
    const shortId = generateShortId();
    expect(shortId.length).toBe(16); // SHORT_ID_LENGTH is 16
  });

  it('should generate a long ID of the correct length', () => {
    const longId = generateLongId();
    expect(longId.length).toBe(32); // LONG_ID_LENGTH is 32
  });

  it('should generate a long ID with a seed and correct padding', () => {
    const seed = 'order/123';
    const longIdWithSeed = generateLongIdWithSeed(seed);
    expect(longIdWithSeed.length).toBe(32); // LONG_ID_LENGTH is 32
    expect(longIdWithSeed).toBe(seed.replace(/[/]/g, '_').replace(/[{}]/g, '').padStart(32, '0'));
  });

  it('should handle consecutive ID generation without collision', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const id = generateLongId();
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  it('should generate unique IDs for multiple invocations', () => {
    const id1 = generateLongId();
    const id2 = generateLongId();
    expect(id1).not.toBe(id2);
  });
});
