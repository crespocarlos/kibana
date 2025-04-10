/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { workerData } from 'piscina';
import type { BaseWorkerParams } from '@kbn/core-worker-threads-server/src/types';
import { initialize } from './initialize_worker';
import type { InternalRouteWorkerData, InternalWorkerParams } from './types';

const { services } = workerData as InternalRouteWorkerData;

export const getWorkerHandler = async () => {
  const { run } = await initialize({ services });

  return ({ filename, input, signal }: InternalWorkerParams) => {
    return run<BaseWorkerParams>({
      filename,
      input,
      signal,
    });
  };
};
