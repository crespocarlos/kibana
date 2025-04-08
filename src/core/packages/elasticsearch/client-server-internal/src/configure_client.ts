/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  Client as ElasticsearchClient,
  HttpConnection,
  ClusterConnectionPool,
  ClientOptions,
  estypes,
  TransportRequestOptions,
} from '@elastic/elasticsearch';
import type { Logger } from '@kbn/logging';
import { type ElasticsearchClientConfig } from '@kbn/core-elasticsearch-server';
import { WorkerThreadsConfigType } from '@kbn/core-worker-threads-server-internal';
import { parseClientOptions } from './client_config';
import { instrumentEsQueryAndDeprecationLogger } from './log_query_and_deprecation';
import { createTransport } from './create_transport';
import type { AgentFactoryProvider } from './agent_manager';
import { patchElasticsearchClient } from './patch_client';
import { WorkerThreadPool } from './worker_thread/worker_thread_pool';

const noop = () => undefined;

// Apply ES client patches on module load
patchElasticsearchClient();

export class CustomClient extends ElasticsearchClient {
  private readonly workerThread: WorkerThreadPool;
  constructor(opts: ClientOptions, workerThreadsConfig: Partial<WorkerThreadsConfigType> = {}) {
    super(opts);
    this.workerThread = new WorkerThreadPool(workerThreadsConfig);
  }

  public get esql(): ElasticsearchClient['esql'] {
    const esqlOrig = super.esql;

    return new Proxy(esqlOrig, {
      get: (target, prop, receiver) => {
        if (prop === 'query') {
          return async (request: estypes.EsqlQueryRequest, options?: TransportRequestOptions) => {
            const result = await target.query.call(target, request, options);

            if (request.format === 'arrow') {
              const controller = new AbortController();

              return this.workerThread.run(import('./worker_thread/esql_parse_response.worker'), {
                input: result,
                signal: controller.signal,
              });
            }

            return result;
          };
        }

        return Reflect.get(target, prop, receiver);
      },
    });
  }
}

export const configureClient = (
  config: ElasticsearchClientConfig,
  {
    logger,
    type,
    scoped = false,
    getExecutionContext = noop,
    agentFactoryProvider,
    kibanaVersion,
    workerThreadsConfig = {},
  }: {
    logger: Logger;
    type: string;
    scoped?: boolean;
    getExecutionContext?: () => string | undefined;
    agentFactoryProvider: AgentFactoryProvider;
    kibanaVersion: string;
    workerThreadsConfig: Partial<WorkerThreadsConfigType>;
  }
): CustomClient => {
  const clientOptions = parseClientOptions(config, scoped, kibanaVersion);
  const KibanaTransport = createTransport({ getExecutionContext });
  const client = new CustomClient(
    {
      ...clientOptions,
      agent: agentFactoryProvider.getAgentFactory(clientOptions.agent),
      Transport: KibanaTransport,
      Connection: HttpConnection,
      // using ClusterConnectionPool until https://github.com/elastic/elasticsearch-js/issues/1714 is addressed
      ConnectionPool: ClusterConnectionPool,
    },
    workerThreadsConfig
  );

  const { apisToRedactInLogs = [] } = config;
  instrumentEsQueryAndDeprecationLogger({ logger, client, type, apisToRedactInLogs });

  return client;
};
