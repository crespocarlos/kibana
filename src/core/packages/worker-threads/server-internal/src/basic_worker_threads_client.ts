/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Piscina from 'piscina';

import { isPromise } from 'util/types';
import {
  WorkerParams,
  WorkerThreadsClient,
  Worker,
  BaseWorkerParams,
} from '@kbn/core-worker-threads-server/src/types';
import { Readable } from 'stream';
import { MessageChannel } from 'worker_threads';

export interface BasicWorkerThreadsClientConfig {
  pool?: Piscina;
}

const isReadable = (obj: any): obj is Readable =>
  obj instanceof Readable && typeof obj._read === 'function';

export class BasicWorkerThreadsClient implements WorkerThreadsClient {
  constructor(private readonly config: BasicWorkerThreadsClientConfig) {}

  async run<TInput extends WorkerParams, TOutput extends WorkerParams>(
    filenameOrImport: string | Promise<Worker<TInput, TOutput, BaseWorkerParams>>,
    { input, signal }: { input: TInput; signal?: AbortSignal }
  ) {
    const { pool } = this.config;

    const isStream = isReadable(input);
    const streamChannel = new MessageChannel();
    if (isStream) {
      input.on('data', (chunk: Uint8Array) => {
        streamChannel.port1.postMessage(chunk.buffer, [chunk.buffer]);
      });

      input.on('end', () => {
        streamChannel.port1.close();
      });
    }

    const runLocally = !pool || isPromise(filenameOrImport);

    if (runLocally) {
      const worker = await (typeof filenameOrImport === 'string'
        ? import(filenameOrImport)
        : filenameOrImport);

      return worker.run({
        input: isStream ? streamChannel.port2 : input,
        signal,
      });
    }

    const result = await pool.run(
      {
        filename: filenameOrImport,
        input: isStream ? streamChannel.port2 : input,
      },
      {
        signal,
        transferList: isStream
          ? [streamChannel.port2]
          : Buffer.isBuffer(input)
          ? [input.buffer]
          : undefined,
      }
    );

    return result;
  }
}
