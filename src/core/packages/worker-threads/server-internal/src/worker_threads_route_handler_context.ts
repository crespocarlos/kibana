/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { WorkerThreadsRequestHandlerContext } from '@kbn/core-worker-threads-server/src/request_handler_context';
import { WorkerThreadsRequestClient } from '@kbn/core-worker-threads-server/src/types';
import { UiSettingsServiceStart } from '@kbn/core-ui-settings-server';
import { KibanaRequest } from '@kbn/core-http-server';
import { InternalElasticsearchServiceStart } from '@kbn/core-elasticsearch-server-internal';
import { InternalSavedObjectsServiceStart } from '@kbn/core-saved-objects-server-internal';
import type { InternalWorkerThreadsServiceStart } from './worker_threads_service';

/**
 * The {@link WorkerThreadsRequestHandlerContext} implementation.
 * @internal
 */
export class CoreWorkerThreadsRouteHandlerContext implements WorkerThreadsRequestHandlerContext {
  #client?: WorkerThreadsRequestClient;

  constructor(
    private readonly workerThreadsStart: InternalWorkerThreadsServiceStart,

    private readonly elasticsearch: InternalElasticsearchServiceStart,
    private readonly uiSettingsService: UiSettingsServiceStart,
    private readonly savedObject: InternalSavedObjectsServiceStart,
    private readonly request: KibanaRequest
  ) {}

  public get client() {
    if (this.#client == null) {
      this.#client = this.workerThreadsStart.getClientWithRequest(
        this.request,
        this.elasticsearch,
        this.savedObject,
        this.uiSettingsService
      );
    }
    return this.#client;
  }
}
