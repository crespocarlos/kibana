/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import { CoreContext, CoreService } from '@kbn/core-base-server-internal';
import { InternalElasticsearchServiceStart } from '@kbn/core-elasticsearch-server-internal';
import { KibanaRequest } from '@kbn/core-http-server';
import { InternalSavedObjectsServiceStart } from '@kbn/core-saved-objects-server-internal';
import { InternalUiSettingsServiceStart } from '@kbn/core-ui-settings-server-internal';
import { Logger } from '@kbn/logging';
import Path from 'path';
import Piscina from 'piscina';
import { firstValueFrom } from 'rxjs';
import { bytes } from '@kbn/config-schema/src/byte_size_value';
import {
  WorkerThreadsClient,
  WorkerThreadsRequestClient,
} from '@kbn/core-worker-threads-server/src/types';
import { RouteWorkerThreadsClient } from './route_worker_threads_client';
import { InternalWorkerData } from './types';
import { serialize } from './utils';
import { WorkerThreadsConfig, WorkerThreadsConfigType } from './worker_threads_config';
import { BasicWorkerThreadsClient } from './basic_worker_threads_client';

type PiscinaOptions = NonNullable<ConstructorParameters<typeof Piscina>[0]>;
/**
 * @internal
 */

type ThreadPoolConfig = WorkerThreadsConfigType & {} & Pick<
    PiscinaOptions,
    'filename' | 'workerData' | 'resourceLimits' | 'maxQueue'
  >;

export interface InternalWorkerThreadsServicePreboot {
  registerPool: (name: string, piscinaConfig: ThreadPoolConfig) => void;
  getClient: (name: string) => WorkerThreadsClient | undefined;
}

export type InternalWorkerThreadsServiceSetup = InternalWorkerThreadsServicePreboot;

/**
 * @internal
 */
export interface InternalWorkerThreadsServiceStart {
  getClientWithRequest: (
    request: KibanaRequest,
    elasticsearch: InternalElasticsearchServiceStart,
    savedObjects: InternalSavedObjectsServiceStart,
    uiSettings: InternalUiSettingsServiceStart
  ) => WorkerThreadsRequestClient;
  getClient: (poolName: string) => WorkerThreadsClient | undefined;
}

const ROUTER_POOL = 'router_pool';
/** @internal */
export class WorkerThreadsService
  implements CoreService<InternalWorkerThreadsServiceSetup, InternalWorkerThreadsServiceStart>
{
  private log: Logger;

  private pools: Map<string, Piscina> = new Map();
  private clients: Map<string, WorkerThreadsClient> = new Map();
  private lastUsedTimestamps: Map<string, number> = new Map();
  private completedTaskByPool: Map<string, number> = new Map();

  private timeoutInterval: number = 5000;

  constructor(private readonly coreContext: CoreContext) {
    this.log = coreContext.logger.get('worker-threads-service');
  }

  async registerPool(name: string, piscinaConfig: ThreadPoolConfig) {
    const services = await serialize({
      ConfigService: this.coreContext.configService,
      Env: this.coreContext.env,
    });

    if (!this.pools.has(name)) {
      const pool = new Piscina({
        filename: piscinaConfig.filename ?? Path.join(__dirname, './basic_worker_entry.js'),
        workerData: {
          services,
        } satisfies InternalWorkerData,
        maxThreads: piscinaConfig.maxWorkers,
        maxQueue: piscinaConfig.maxQueue,
        minThreads: piscinaConfig.minWorkers,
        idleTimeout: piscinaConfig.idleTimeout,
        concurrentTasksPerWorker: piscinaConfig.concurrentTasksPerWorker,
        resourceLimits: piscinaConfig.resourceLimits,
      });

      // pool.on('message', ({ message }) => {
      //   this.log.info(message);
      // });

      this.pools.set(name, pool);

      this.lastUsedTimestamps.set(name, Date.now());
    }
  }

  getClient(name: string): WorkerThreadsClient | undefined {
    const pool = this.pools.get(name);

    if (!pool) {
      this.log.info(`Pool '${name}' not found`);
      return;
    }

    this.lastUsedTimestamps.set(name, Date.now());

    if (this.clients.has(name)) {
      return this.clients.get(name);
    }

    const client = new BasicWorkerThreadsClient({ pool });
    this.clients.set(name, client);
    return client;
  }

  public async preboot(): Promise<InternalWorkerThreadsServicePreboot> {
    const config = await firstValueFrom(
      this.coreContext.configService.atPath<WorkerThreadsConfigType>('workerThreads')
    );
    const workerThreadConfig = new WorkerThreadsConfig(config);

    this.log.info(JSON.stringify(workerThreadConfig));

    if (workerThreadConfig.enabled) {
      await this.registerPool(ROUTER_POOL, {
        filename: Path.join(__dirname, './route_worker_entry.js'),
        ...workerThreadConfig,
      });
    }

    return {
      registerPool: async (name: string, piscinaConfig: ThreadPoolConfig) =>
        this.registerPool(name, piscinaConfig),
      getClient: (name: string) => this.getClient(name),
    };
  }

  public setup(): InternalWorkerThreadsServiceSetup {
    return {
      registerPool: async (name: string, piscinaConfig: ThreadPoolConfig) =>
        this.registerPool(name, piscinaConfig),
      getClient: (name: string) => this.getClient(name),
    };
  }

  public async start(): Promise<InternalWorkerThreadsServiceStart> {
    setInterval(() => {
      const { rss, heapTotal, heapUsed } = process.memoryUsage();

      const workerStats = Array.from(this.pools.entries()).reduce((acc, [name, pool]) => {
        const currentCompletedTask = this.completedTaskByPool.get(name);
        const tasksCompletedThisInterval = pool.completed - (currentCompletedTask ?? 0);

        const throughput = tasksCompletedThisInterval / (this.timeoutInterval / 1000);

        acc[name] = {
          size: pool.threads.length,
          queueSize: pool.queueSize,
          totalCompleted: pool.completed,
          completedThisCycle: tasksCompletedThisInterval,
          throughputPerSecond: throughput,
        };

        this.completedTaskByPool.set(name, pool.completed);

        return acc;
      }, {} as Record<string, { size: number; queueSize: number; totalCompleted: number; completedThisCycle: number; throughputPerSecond: number }>);

      this.log.info(
        `Main thread stats: ${JSON.stringify({
          rss: bytes(rss).toString(),
          heapTotal: bytes(heapTotal).toString(),
          heapUsed: bytes(heapUsed).toString(),
          workers: workerStats,
        })}`
      );
    }, this.timeoutInterval).unref();

    // const tmpDir = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'worker-heapsnapshots'));

    // const log = this.log;

    // setTimeout(function generateSnapshots() {
    //   Promise.allSettled(
    //     routeWorkerPool?.threads.map(async (thread) => {
    //       log.info(`Getting heap snapshot for ${thread.threadId}`);
    //       const readable = await thread.getHeapSnapshot();
    //       const fileName = Path.join(tmpDir, `worker-${thread.threadId}.heapsnapshot`);
    //       const fileStream = createWriteStream(fileName, { encoding: 'utf-8' });

    //       log.info(`Writing heap snapshot to ${fileName}`);

    //       readable.pipe(fileStream);
    //       await finished(fileStream);

    //       log.info(`Wrote heap snapshot to ${fileName}`);
    //     }) ?? []
    //   ).then((results) => {
    //     results.forEach((result) => {
    //       if (result.status === 'rejected') {
    //         log.error(result.reason);
    //       }
    //     });
    //     setTimeout(generateSnapshots, 5000);
    //   });
    // }, 5000);

    return {
      getClientWithRequest: (
        request: KibanaRequest,
        elasticsearch: InternalElasticsearchServiceStart,
        savedObjects: InternalSavedObjectsServiceStart,
        uiSettings: InternalUiSettingsServiceStart
      ) => {
        return new RouteWorkerThreadsClient({
          request,
          elasticsearch,
          savedObjects,
          uiSettings,
          pool: this.pools.get(ROUTER_POOL),
          logger: this.log,
        });
      },
      getClient: (poolName) => {
        return this.getClient(poolName);
      },
    };
  }

  public getStats(): Record<string, any> {
    return Array.from(this.pools.entries()).reduce((acc, [name, pool]) => {
      acc[name] = {
        size: pool.threads.length,
        queueSize: pool.queueSize,
        completed: pool.completed,
        runTime: pool.runTime,
        idleTime: Date.now() - (this.lastUsedTimestamps.get(name) ?? 0),
      };
      return acc;
    }, {} as Record<string, any>);
  }

  public async stop(): Promise<void> {
    await this.pools.forEach((item) => item.destroy());

    this.pools.clear();
    this.lastUsedTimestamps.clear();
  }
}
