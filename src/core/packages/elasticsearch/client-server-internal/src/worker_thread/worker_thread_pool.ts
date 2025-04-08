/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Piscina from 'piscina';
import { WorkerThreadsConfigType } from '@kbn/core-worker-threads-server-internal';
import {
  Worker,
  WorkerParams,
  WorkerThreadsClient,
} from '@kbn/core-worker-threads-server/src/types';
import { isPromise } from 'util/types';

export type QueryWorker<
  TInput extends WorkerParams = WorkerParams,
  TOutput extends WorkerParams = WorkerParams
> = Worker<TInput, TOutput>;

export class WorkerThreadPool implements WorkerThreadsClient {
  private readonly workerPool?: Piscina;

  constructor(private readonly config: Partial<WorkerThreadsConfigType>) {
    if (config.enabled) {
      this.workerPool = new Piscina({
        minThreads: config.minWorkers,
        maxThreads: config.maxWorkers,
        idleTimeout: config.idleTimeout,
        concurrentTasksPerWorker: config.concurrentTasksPerWorker,
      });
    }
  }
  async run<TInput extends WorkerParams, TOutput extends WorkerParams>(
    filenameOrImport: string | Promise<QueryWorker<TInput, TOutput>>,
    { input, signal }: { input: TInput; signal: AbortSignal }
  ): Promise<WorkerParams> {
    const runLocally = !this.workerPool || isPromise(filenameOrImport);

    if (runLocally) {
      const worker = await (typeof filenameOrImport === 'string'
        ? import(filenameOrImport)
        : filenameOrImport);
      return worker.run({
        input,
        signal,
      });
    }

    return this.workerPool?.run(
      {
        filename: filenameOrImport,
        input,
      },
      {
        signal,
      }
    );
  }

  public isEnabled(): boolean {
    return Boolean(this.config.enabled);
  }
}
