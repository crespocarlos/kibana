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

export interface BasicWorkerThreadsClientConfig {
  pool?: Piscina;
}

export class BasicWorkerThreadsClient implements WorkerThreadsClient {
  constructor(private readonly config: BasicWorkerThreadsClientConfig) {}

  async run<TInput extends WorkerParams, TOutput extends WorkerParams>(
    filenameOrImport: string | Promise<Worker<TInput, TOutput, BaseWorkerParams>>,
    { input, signal }: { input: TInput; signal?: AbortSignal }
  ) {
    const runLocally = !this.config.pool || isPromise(filenameOrImport);

    if (runLocally) {
      const worker = await (typeof filenameOrImport === 'string'
        ? import(filenameOrImport)
        : filenameOrImport);
      return worker.run({
        input,
        signal,
      });
    }

    return this.config.pool?.run(
      {
        filename: filenameOrImport,
        input,
      },
      {
        signal,
      }
    );
  }
}
