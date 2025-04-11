/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
const { parentPort, threadId } = require('worker_threads');
const { RecordBatchStreamWriter, tableFromIPC, RecordBatchStreamReader } = require('apache-arrow');
const {
  Observable,
  fromEvent,
  map,
  scan,
  lastValueFrom,
  filter,
  EMPTY,
  takeUntil,
} = require('rxjs');

function streamIntoObservable(readable) {
  if (!readable) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }
  return new Observable((subscriber) => {
    const decodedStream = readable;

    async function process() {
      for await (const item of decodedStream) {
        subscriber.next(item);
      }
    }

    process()
      .then(() => {
        subscriber.complete();
      })
      .catch((error) => {
        subscriber.error(error);
      });
  });
}

const worker = {
  run: async ({ input }) => {
    const streamed = await lastValueFrom(
      fromEvent(input, 'message').pipe(
        map(({ data }) => {
          return data;
        }),
        scan((acc, current) => {
          const concatenated = new Uint8Array(acc.length + current.length);
          concatenated.set(acc, 0);
          concatenated.set(current, acc.length);
          return concatenated;
        }, new Uint8Array()),
        takeUntil(fromEvent(input, 'close'))
      )
    );

    const reader = await RecordBatchStreamReader.from(streamed);
    const table = tableFromIPC(new Uint8Array(reader));
    const writer = RecordBatchStreamWriter.writeAll(table);
    const serializedBuffer = await writer.toUint8Array();

    // eslint-disable-next-line no-undef
    const sharedBuffer = new SharedArrayBuffer(serializedBuffer.byteLength);
    const sharedResponse = new Uint8Array(sharedBuffer);
    sharedResponse.set(serializedBuffer);

    parentPort?.postMessage({
      type: 'metrics',
      message: `Worker ${threadId} finished`,
    });

    return sharedBuffer;
  },
};

module.exports = { run: worker.run };
