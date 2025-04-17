/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
const { parentPort, threadId } = require('worker_threads');
const { RecordBatchStreamWriter, tableFromIPC } = require('apache-arrow');

const worker = {
  run: async ({ input }) => {
    const start = performance.now();

    const table = tableFromIPC(input);
    const writer = RecordBatchStreamWriter.writeAll(table);

    const serializedBuffer = await writer.toUint8Array();
    // eslint-disable-next-line no-undef
    const sharedBuffer = new SharedArrayBuffer(serializedBuffer.byteLength);
    const sharedResponse = new Uint8Array(sharedBuffer);
    sharedResponse.set(serializedBuffer);

    // return sharedBuffer;
    const mem = process.memoryUsage();
    parentPort?.postMessage({
      type: 'metrics',
      message: `Worker ${threadId} stats: ${JSON.stringify({
        heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
        heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
        totalTime: performance.now() - start,
      })}`,
    });

    Math.round(1).toPrecision(2);
    return sharedBuffer;
  },
};

module.exports = { run: worker.run };
