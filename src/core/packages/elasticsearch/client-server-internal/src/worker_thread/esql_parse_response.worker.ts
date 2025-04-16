/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Worker } from '@kbn/core-worker-threads-server';
import { RecordBatchStreamReader, RecordBatchStreamWriter } from 'apache-arrow';

import { parentPort, threadId } from 'worker_threads';

const worker: Worker<MessagePort, SharedArrayBuffer> = {
  run: async ({ input }) => {
    const start = performance.now();

    const outputChunks: Buffer[] = [];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        input.addEventListener('message', (event: MessageEvent<Uint8Array>) => {
          controller.enqueue(event.data);
        });
      },
    });

    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        outputChunks.push(Buffer.from(chunk));
      },
    });

    const reader = RecordBatchStreamReader.from(stream);
    const writer = await RecordBatchStreamWriter.writeAll(reader);

    await writer.pipeTo(writable);

    const serializedBuffer = Buffer.concat(outputChunks);
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

    return sharedBuffer;
  },
};

export const run = worker.run;
