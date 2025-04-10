/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Worker } from '@kbn/core-worker-threads-server';
import * as arrow from 'apache-arrow';

const worker: Worker<ArrayBuffer, SharedArrayBuffer> = {
  run: async ({ input }) => {
    const table = arrow.tableFromIPC(new Uint8Array(input));

    const writer = arrow.RecordBatchStreamWriter.writeAll(table);

    const serializedBuffer = await writer.toUint8Array();

    const sharedBuffer = new SharedArrayBuffer(serializedBuffer.byteLength);
    const sharedResponse = new Uint8Array(sharedBuffer);
    sharedResponse.set(serializedBuffer);

    return sharedBuffer;
  },
};

export const run = worker.run;
