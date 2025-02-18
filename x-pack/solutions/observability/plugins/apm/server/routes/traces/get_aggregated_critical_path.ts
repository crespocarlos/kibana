/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { existsQuery, rangeQuery, termsQuery } from '@kbn/observability-plugin/server';
import type { Logger } from '@kbn/logging';
import { unflattenKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import type { Sort } from '@elastic/elasticsearch/lib/api/types';
import {
  AT_TIMESTAMP,
  TRACE_ID,
  AGENT_NAME,
  SERVICE_NAME,
  SPAN_SUBTYPE,
  SPAN_TYPE,
  SPAN_ID,
  SPAN_DESTINATION_SERVICE_RESOURCE,
  PARENT_ID,
  TRANSACTION_NAME,
  TRANSACTION_TYPE,
  SPAN_DURATION,
  TRANSACTION_DURATION,
  SPAN_NAME,
  PROCESSOR_EVENT,
  TRANSACTION_ID,
  SERVICE_NODE_NAME,
} from '../../../common/es_fields/apm';
import type { AgentName } from '../../../typings/es_schemas/ui/fields/agent';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { asMutableArray } from '../../../common/utils/as_mutable_array';

export interface CriticalPathTransaction {
  traceId: string;
  transactionId: string;
  agentName: AgentName;
  serviceName: string;
  serviceNodeName?: string;
  transactionName: string;
  transactionType: string;
  transactionDuration: number;
  timestamp: string;
  parentId?: string;
  processorEvent: ProcessorEvent.transaction;
}

export interface CriticalPathSpan {
  traceId: string;
  spanId: string;
  spanName: string;
  spanType: string;
  spanSubtype?: string;
  spanDestinationServiceResource?: string;
  serviceName: string;
  serviceNodeName?: string;
  agentName: AgentName;
  spanDuration: number;
  parentId?: string;
  timestamp: string;
  processorEvent: ProcessorEvent.span;
}
export interface CriticalPathResponse {
  path: Array<CriticalPathSpan | CriticalPathTransaction>;
  entryTransactions: CriticalPathTransaction[];
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export async function getAggregatedCriticalPath({
  traceIds,
  start,
  end,
  apmEventClient,
  serviceName,
  transactionName,
  logger,
}: {
  traceIds: string[];
  start: number;
  end: number;
  apmEventClient: APMEventClient;
  serviceName: string | null;
  transactionName: string | null;
  logger: Logger;
}): Promise<CriticalPathResponse> {
  logger.debug(`Fetching spans (${traceIds.length} traces)`);

  let now = performance.now();

  console.log('fetchEntryTransactionsFromTraceIds', performance.now() - now);
  now = performance.now();

  const [exitSpansSample, entryTransactions] = await Promise.all([
    fetchSpansFromTraceIds({
      apmEventClient,
      traceIds,
      start,
      end,
    }),
    fetchEntryTransactions({
      apmEventClient,
      traceIds,
      start,
      end,
    }),
  ]);

  const transactions = await transactionsForExitSpans({
    apmEventClient,
    exitSpansSample,
    start,
    end,
  });

  return {
    entryTransactions,
    path: [...transactions, ...Array.from(exitSpansSample.values())],
  };
}

async function fetchEntryTransactions({
  apmEventClient,
  traceIds,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  traceIds: string[];
  start: number;
  end: number;
}): Promise<CriticalPathTransaction[]> {
  const entryTransactionsSample = await apmEventClient.search(
    'get_critical_path_entry_transactions_sample',
    {
      apm: {
        events: [ProcessorEvent.transaction],
      },
      body: {
        track_total_hits: false,
        size: 0,
        query: {
          bool: {
            filter: [...rangeQuery(start, end), ...termsQuery(TRACE_ID, ...traceIds)],
            must_not: [...existsQuery(PARENT_ID)],
          },
        },
        aggs: {
          entryTansactions: {
            composite: {
              sources: asMutableArray([
                {
                  serviceName: {
                    terms: { field: SERVICE_NAME },
                  },
                },
                {
                  transactionName: {
                    terms: { field: TRANSACTION_NAME },
                  },
                },
              ] as const),
              size: 10000,
            },
            aggs: {
              // duration: {
              //   sum: {
              //     field: TRANSACTION_DURATION,
              //   },
              // },
              sample: {
                top_metrics: {
                  size: 1,
                  sort: {
                    [AT_TIMESTAMP]: 'asc',
                  },
                  metrics: asMutableArray([
                    { field: TRACE_ID },
                    { field: AT_TIMESTAMP },
                    { field: AGENT_NAME },
                    { field: PROCESSOR_EVENT },
                    { field: SERVICE_NODE_NAME },
                    { field: SPAN_ID },
                    { field: TRANSACTION_ID },
                    { field: TRANSACTION_TYPE },
                    { field: TRANSACTION_DURATION },
                  ] as const),
                },
              },
            },
          },
        },
      },
    }
  );

  return (entryTransactionsSample.aggregations?.entryTansactions.buckets ?? []).map((bucket) => {
    const sample = bucket.sample.top[0].metrics;

    return {
      traceId: sample[TRACE_ID] as string,
      transactionId: sample[TRANSACTION_ID] as string,
      transactionName: bucket.key.transactionName as string,
      transactionType: sample[TRANSACTION_TYPE] as string,
      transactionDuration: sample[TRANSACTION_DURATION] as number, // bucket.duration.value as number, // bucket.duration.value as number,
      timestamp: sample[AT_TIMESTAMP] as string,
      serviceName: bucket.key.serviceName as string,
      serviceNodeName: sample[SERVICE_NODE_NAME] as string,
      agentName: sample[AGENT_NAME] as AgentName,
      processorEvent: ProcessorEvent.transaction,
    };
  });
}

// async function transactionsForExitSpans({
//   apmEventClient,
//   exitSpansSample,
//   start,
//   end,
// }: {
//   apmEventClient: APMEventClient;
//   exitSpansSample: Map<string, CriticalPathSpan>;
//   start: number;
//   end: number;
// }): Promise<CriticalPathTransaction[]> {
//   const entryTransactionsSample = await apmEventClient.search(
//     'get_critical_path_entry_transactions_sample',
//     {
//       apm: {
//         events: [ProcessorEvent.transaction],
//       },
//       body: {
//         track_total_hits: false,
//         size: 0,
//         query: {
//           bool: {
//             filter: [
//               ...rangeQuery(start, end),
//               ...termsQuery(PARENT_ID, ...exitSpansSample.keys()),
//             ],
//           },
//         },
//         aggs: {
//           entryTansactions: {
//             composite: {
//               sources: asMutableArray([
//                 { serviceNodeName: { terms: { field: SERVICE_NODE_NAME, missing_bucket: true } } },
//                 {
//                   serviceName: {
//                     terms: { field: SERVICE_NAME },
//                   },
//                 },
//                 {
//                   transactionName: {
//                     terms: { field: TRANSACTION_NAME },
//                   },
//                 },
//               ] as const),
//               size: 10000,
//             },
//             aggs: {
//               duration: {
//                 sum: {
//                   field: TRANSACTION_DURATION,
//                 },
//               },
//               sample: {
//                 top_metrics: {
//                   size: 1,
//                   sort: {
//                     [TRANSACTION_DURATION]: 'desc',
//                   },
//                   metrics: asMutableArray([
//                     { field: TRACE_ID },
//                     { field: AT_TIMESTAMP },
//                     { field: AGENT_NAME },
//                     { field: PROCESSOR_EVENT },
//                     { field: SERVICE_NODE_NAME },
//                     { field: SPAN_ID },
//                     { field: TRANSACTION_ID },
//                     { field: TRANSACTION_TYPE },
//                     { field: TRANSACTION_DURATION },
//                     { field: PARENT_ID },
//                   ] as const),
//                 },
//               },
//             },
//           },
//         },
//       },
//     }
//   );

//   return (entryTransactionsSample.aggregations?.entryTansactions.buckets ?? []).map((bucket) => {
//     const sample = bucket.sample.top[0].metrics;

//     return {
//       traceId: sample[TRACE_ID] as string,
//       transactionId: sample[TRANSACTION_ID] as string,
//       transactionName: bucket.key.transactionName as string,
//       transactionType: sample[TRANSACTION_TYPE] as string,
//       transactionDuration: bucket.duration.value as number,
//       timestamp: sample[AT_TIMESTAMP] as string,
//       serviceName: bucket.key.serviceName as string,
//       serviceNodeName: sample[SERVICE_NODE_NAME] as string,
//       agentName: sample[AGENT_NAME] as AgentName,
//       parentId: sample[PARENT_ID] as string,
//       processorEvent: ProcessorEvent.transaction,
//     };
//   });
// }

async function transactionsForExitSpans({
  apmEventClient,
  start,
  end,
  exitSpansSample,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  exitSpansSample: Map<string, CriticalPathSpan>;
}) {
  const requiredFields = asMutableArray([
    TRACE_ID,
    SPAN_ID,
    SERVICE_NAME,
    AGENT_NAME,
    AT_TIMESTAMP,
    TRANSACTION_ID,
    TRANSACTION_NAME,
    TRANSACTION_TYPE,
    TRANSACTION_DURATION,
  ] as const);

  const optionalSpanFields = asMutableArray([PARENT_ID, SERVICE_NODE_NAME] as const);

  const sampleExitSpans = await apmEventClient.search('get_critical_path_span_samples', {
    apm: {
      events: [ProcessorEvent.transaction],
    },
    body: {
      track_total_hits: false,
      query: {
        bool: {
          filter: [...rangeQuery(start, end), ...termsQuery(PARENT_ID, ...exitSpansSample.keys())],
        },
      },
      fields: [...requiredFields, ...optionalSpanFields],
      sort: [
        { _score: 'asc' },
        { [TRANSACTION_DURATION]: 'desc' },
        { [AT_TIMESTAMP]: 'asc' },
      ] as Sort,
      size: exitSpansSample.size,
    },
  });

  return sampleExitSpans.hits.hits
    .map((hit): CriticalPathTransaction | undefined => {
      const { transaction, agent, service, parent, span, trace, ...remainingFields } =
        unflattenKnownApmEventFields(hit.fields, requiredFields);

      return {
        traceId: trace.id as string,
        transactionId: transaction.id as string,
        transactionName: transaction.name as string,
        transactionType: transaction.type as string,
        transactionDuration: transaction.duration.us as number,
        timestamp: remainingFields['@timestamp'] as string,
        serviceName: service.name as string,
        serviceNodeName: service.node?.name as string,
        agentName: agent.name as AgentName,
        parentId: parent?.id as string,
        processorEvent: ProcessorEvent.transaction,
      };
    })
    .filter((transaction): transaction is CriticalPathTransaction => !!transaction);
}

async function fetchSpansFromTraceIds({
  apmEventClient,
  traceIds,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  traceIds: string[];
  start: number;
  end: number;
}) {
  const sampleExitSpans = await apmEventClient.search('get_service_map_exit_span_samples', {
    apm: {
      events: [ProcessorEvent.span],
    },
    body: {
      track_total_hits: false,
      size: 0,
      query: {
        bool: {
          filter: [
            ...rangeQuery(start, end),
            ...termsQuery(TRACE_ID, ...traceIds),
            ...existsQuery(SPAN_DESTINATION_SERVICE_RESOURCE),
          ],
          should: [...existsQuery(PARENT_ID)],
        },
      },
      aggs: {
        exitSpans: {
          composite: {
            sources: asMutableArray([
              { serviceNodeName: { terms: { field: SERVICE_NODE_NAME, missing_bucket: true } } },
              { serviceName: { terms: { field: SERVICE_NAME } } },
              {
                spanName: {
                  terms: { field: SPAN_NAME },
                },
              },
            ] as const),
            size: 10000,
          },
          aggs: {
            // duration: {
            //   avg: {
            //     field: SPAN_DURATION,
            //   },
            // },
            sample: {
              top_metrics: {
                size: 1,
                sort: {
                  [AT_TIMESTAMP]: 'desc',
                },
                metrics: asMutableArray([
                  { field: TRACE_ID },
                  { field: SPAN_ID },
                  { field: SPAN_TYPE },
                  { field: SPAN_SUBTYPE },
                  { field: SPAN_NAME },
                  { field: SERVICE_NAME },
                  { field: AGENT_NAME },
                  { field: AT_TIMESTAMP },
                  { field: SERVICE_NODE_NAME },
                  { field: SPAN_SUBTYPE },
                  { field: SPAN_DURATION },
                  { field: PARENT_ID },
                ] as const),
              },
            },
          },
        },
      },
    },
  });

  const destinationBySpanId = new Map<string, CriticalPathSpan>();

  (sampleExitSpans.aggregations?.exitSpans.buckets ?? []).forEach(
    (bucket): CriticalPathSpan | undefined => {
      const sample = bucket.sample.top[0].metrics;
      if (!sample) {
        return;
      }

      const spanId = sample[SPAN_ID] as string;
      if (!spanId) {
        return;
      }

      destinationBySpanId.set(spanId, {
        spanId,
        traceId: sample[TRACE_ID] as string,
        spanType: sample[SPAN_TYPE] as string,
        spanSubtype: sample[SPAN_SUBTYPE] as string,
        spanName: sample[SPAN_NAME] as string,
        serviceName: sample[SERVICE_NAME] as string,
        agentName: sample[AGENT_NAME] as AgentName,
        timestamp: sample[AT_TIMESTAMP] as string,
        serviceNodeName: sample[SERVICE_NODE_NAME] as string,
        spanDuration: sample[SPAN_DURATION] as number, // bucket.duration.value as number, //  as number,
        parentId: sample[PARENT_ID] as string,
        processorEvent: ProcessorEvent.span,
      });
    }
  );

  return destinationBySpanId;
}
