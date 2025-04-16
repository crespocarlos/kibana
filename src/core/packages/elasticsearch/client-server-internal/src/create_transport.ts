/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { IncomingHttpHeaders } from 'http';
import { WorkerThreadsClient } from '@kbn/core-worker-threads-server/src/types';
import {
  Transport,
  type TransportOptions,
  type TransportRequestParams,
  type TransportRequestOptions,
  type TransportResult,
} from '@elastic/elasticsearch';
import { isUnauthorizedError } from '@kbn/es-errors';
import { InternalUnauthorizedErrorHandler, isRetryResult } from './retry_unauthorized';

type TransportClass = typeof Transport;

export type ErrorHandlerAccessor = () => InternalUnauthorizedErrorHandler;

const noop = () => undefined;

export const createTransport = ({
  getExecutionContext = noop,
  getUnauthorizedErrorHandler,
  workerThreadsClient,
}: {
  getExecutionContext?: () => string | undefined;
  getUnauthorizedErrorHandler?: ErrorHandlerAccessor;
  workerThreadsClient?: WorkerThreadsClient;
}): TransportClass => {
  class KibanaTransport extends Transport {
    private headers: IncomingHttpHeaders = {};

    constructor(options: TransportOptions) {
      const { headers = {}, ...otherOptions } = options;
      super(otherOptions);
      this.headers = headers;
    }

    async request(params: TransportRequestParams, options?: TransportRequestOptions) {
      const opts: TransportRequestOptions = options ? { ...options } : {};
      // sync override of maxResponseSize and maxCompressedResponseSize

      if (options) {
        if (
          options.maxResponseSize !== undefined &&
          options.maxCompressedResponseSize === undefined
        ) {
          opts.maxCompressedResponseSize = options.maxResponseSize;
        } else if (
          options.maxCompressedResponseSize !== undefined &&
          options.maxResponseSize === undefined
        ) {
          opts.maxResponseSize = options.maxCompressedResponseSize;
        }
      }
      const opaqueId = getExecutionContext();
      if (opaqueId && !opts.opaqueId) {
        // rewrites headers['x-opaque-id'] if it presents
        opts.opaqueId = opaqueId;
      }

      // add stored headers to the options
      opts.headers = {
        ...this.headers,
        ...options?.headers,
      };

      try {
        const isArrow = (params.querystring as { format: string } | undefined)?.format === 'arrow';

        const response = await super.request(params, {
          ...opts,
          asStream: isArrow,
        });

        if (isArrow && workerThreadsClient) {
          const controller = new AbortController();

          return await workerThreadsClient.run(
            import('./worker_thread/esql_parse_response.worker'),
            {
              input: response as any,
              signal: controller.signal,
            }
          );
        }

        return response as TransportResult<any, any>;
      } catch (e) {
        if (isUnauthorizedError(e)) {
          const unauthorizedErrorHandler = getUnauthorizedErrorHandler
            ? getUnauthorizedErrorHandler()
            : undefined;
          if (unauthorizedErrorHandler) {
            const result = await unauthorizedErrorHandler(e);
            if (isRetryResult(result)) {
              this.headers = {
                ...this.headers,
                ...result.authHeaders,
              };
              const retryOpts = { ...opts };
              retryOpts.headers = {
                ...this.headers,
                ...options?.headers,
              };
              return (await super.request(params, retryOpts)) as TransportResult<any, any>;
            }
          }
        }
        throw e;
      }
    }
  }

  return KibanaTransport;
};
