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
import { WorkerThreadsRequestClient } from '@kbn/core-worker-threads-server/src/types';
import { parseClientOptions } from './client_config';
import { instrumentEsQueryAndDeprecationLogger } from './log_query_and_deprecation';
import { createTransport } from './create_transport';
import type { AgentFactoryProvider } from './agent_manager';
import { patchElasticsearchClient } from './patch_client';

const noop = () => undefined;

// Apply ES client patches on module load
patchElasticsearchClient();

function decorateEsqlQuery(
  esql: ElasticsearchClient['esql'],
  workerThreadsClient?: WorkerThreadsRequestClient
): ElasticsearchClient['esql'] {
  return new Proxy(esql, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return async (request: estypes.EsqlQueryRequest, options?: TransportRequestOptions) => {
          const result = await target.query.call(target, request, options);

          if (request.format === 'arrow' && workerThreadsClient) {
            return workerThreadsClient.run(import('./worker_thread/esql_parse_response.worker'), {
              input: result,
            });
          }

          return result;
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

// POC
export class CustomClient extends ElasticsearchClient {
  constructor(
    opts: ClientOptions,
    private readonly workerThreadsClient?: WorkerThreadsRequestClient
  ) {
    super(opts);
  }

  public override get esql(): ElasticsearchClient['esql'] {
    return decorateEsqlQuery(super.esql, this.workerThreadsClient);
  }

  override child(opts: ClientOptions): CustomClient {
    const childClient = super.child(opts);

    const baseEsql =
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(ElasticsearchClient.prototype),
        'esql'
      )?.get?.call(childClient) ?? childClient.esql;

    Object.defineProperty(childClient, 'esql', {
      get: () => decorateEsqlQuery(baseEsql, this.workerThreadsClient),
    });

    return childClient as CustomClient;
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
    workerThreadsClient,
  }: {
    logger: Logger;
    type: string;
    scoped?: boolean;
    getExecutionContext?: () => string | undefined;
    agentFactoryProvider: AgentFactoryProvider;
    kibanaVersion: string;
    workerThreadsClient?: WorkerThreadsRequestClient;
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
    workerThreadsClient
  );

  const { apisToRedactInLogs = [] } = config;
  instrumentEsQueryAndDeprecationLogger({ logger, client, type, apisToRedactInLogs });

  return client;
};
