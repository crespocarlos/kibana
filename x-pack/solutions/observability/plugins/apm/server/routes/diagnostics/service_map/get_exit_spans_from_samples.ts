/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { termQuery, rangeQuery, termsQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { unflattenKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import type { ESSearchResponse, ESSearchRequest } from '@kbn/es-types';
import {
  SERVICE_NAME,
  SPAN_ID,
  SPAN_TYPE,
  SPAN_SUBTYPE,
  TRACE_ID,
  TRANSACTION_ID,
  SPAN_NAME,
  SERVICE_NODE_NAME,
  AGENT_NAME,
  PARENT_ID,
  SPAN_DESTINATION_SERVICE_RESOURCE,
} from '@kbn/apm-types';
import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import type { ExitSpanFields } from '../../../../common/service_map_diagnostic_types';
import { asMutableArray } from '../../../../common/utils/as_mutable_array';

export async function getExitSpans({
  apmEventClient,
  start,
  end,
  destinationNode,
  parentSpans,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  sourceNode: string;
  destinationNode: string;
  parentSpans: Map<string, string | undefined>;
}) {
  const requiredFields = asMutableArray([
    SERVICE_NAME,
    SPAN_ID,
    SPAN_TYPE,
    SPAN_SUBTYPE,
    TRACE_ID,
    TRANSACTION_ID,
    SPAN_NAME,
    SERVICE_NODE_NAME,
    PARENT_ID,
    AGENT_NAME,
  ] as const);

  const response = await apmEventClient.search('diagnostics_get_exit_spans_from_source_node', {
    apm: {
      events: [ProcessorEvent.transaction],
    },
    track_total_hits: false,
    size: 0,
    query: {
      bool: {
        filter: [...rangeQuery(start, end), ...termsQuery(PARENT_ID, ...Object.keys(parentSpans))],
      },
    },
    aggs: {
      matching_destination_resources: {
        filter: {
          term: {
            [SERVICE_NAME]: destinationNode,
          },
        },
        aggs: {
          sample_docs: {
            top_hits: {
              size: 50,
              fields: [...requiredFields],
            },
          },
        },
      },
    },
  });

  const apmExitSpans = (
    response?.aggregations?.matching_destination_resources?.sample_docs?.hits?.hits ?? []
  )
    .map((p) => {
      const fields = unflattenKnownApmEventFields(p?.fields);

      if (!fields.parent?.id || !parentSpans.get(fields?.parent?.id)) {
        return;
      }

      return {
        destinationService: fields?.service?.name,
        spanSubType: fields?.span?.subtype ?? '',
        spanId: fields?.span?.id ?? '',
        spanType: fields?.span?.type ?? '',
        transactionId: fields?.transaction?.id ?? '',
        serviceNodeName: fields?.service?.node?.name ?? '',
        traceId: fields?.trace?.id ?? '',
        agentName: fields?.agent?.name ?? '',
        docCount: 100,
        isOtel: false,
      };
    })
    .filter((p): p is ExitSpanFields => !!p);

  return {
    apmExitSpans,
    totalConnections: apmExitSpans.length,
    rawResponse: response,
    hasMatchingDestinationResources: apmExitSpans.length > 0,
  };
}

export async function getSourceSpanIds({
  apmEventClient,
  start,
  end,
  sourceNode,
  traceIds,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  sourceNode: string;
  traceIds: string[];
}): Promise<{
  spanIds: Map<string, string | undefined>;
  sourceSpanIdsRawResponse: ESSearchResponse<unknown, ESSearchRequest>;
}> {
  const requiredFields = asMutableArray([SPAN_ID] as const);
  const optionalFields = asMutableArray([SPAN_DESTINATION_SERVICE_RESOURCE] as const);
  const response = await apmEventClient.search('diagnostics_get_source_node_span_samples', {
    apm: {
      events: [ProcessorEvent.span],
    },
    track_total_hits: false,
    size: 0,
    query: {
      bool: {
        filter: [...rangeQuery(start, end), ...termsQuery(TRACE_ID, ...traceIds)],
      },
    },
    aggs: {
      sample_docs: {
        composite: {
          sources: asMutableArray([
            { serviceName: { terms: { field: SERVICE_NAME } } },
            {
              spanName: {
                terms: { field: SPAN_NAME },
              },
            },
          ] as const),
          size: 500,
        },
        aggs: {
          top_span_ids: {
            top_hits: {
              size: 10,
              fields: [...requiredFields, ...optionalFields],
            },
          },
        },
      },
    },
  });

  const map = new Map<string, string | undefined>();
  return {
    sourceSpanIdsRawResponse: response,
    spanIds:
      response.aggregations?.sample_docs?.buckets?.reduce((acc, bucket) => {
        const event = unflattenKnownApmEventFields(
          bucket.top_span_ids.hits.hits[0].fields,
          requiredFields
        );

        acc.set(event.span.id, event.span?.destination?.service?.resource);

        return acc;
      }, map) ?? map,
  };
}

export async function getDestinationParentIds({
  apmEventClient,
  start,
  end,
  ids,
  destinationNode,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  ids: string[] | undefined;
  destinationNode: string;
}) {
  const response = await apmEventClient.search('diagnostics_get_destination_node_parent_ids', {
    apm: {
      events: [ProcessorEvent.transaction],
    },
    track_total_hits: false,
    size: 1,
    query: {
      bool: {
        filter: [
          ...rangeQuery(start, end),
          ...(ids ? termsQuery(PARENT_ID, ...ids) : []),
          ...termQuery(SERVICE_NAME, destinationNode),
        ],
      },
    },
    aggs: {
      sample_docs: {
        top_hits: {
          size: 5,
          fields: [PARENT_ID, SERVICE_NAME, SPAN_DESTINATION_SERVICE_RESOURCE],
        },
      },
    },
  });

  return { rawResponse: response, hasParent: response.hits.hits.length > 0 };
}

export async function getExitSpansFromSamples({
  apmEventClient,
  start,
  end,
  ids,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  ids: string[] | undefined;
}) {
  const response = await apmEventClient.search('diagnostics_get_exit_spans_from_samples', {
    apm: {
      events: [ProcessorEvent.span],
    },
    track_total_hits: false,
    size: 1,
    terminate_after: 1,
    query: {
      bool: {
        filter: [...rangeQuery(start, end), ...(ids ? termsQuery(SPAN_ID, ...ids) : [])],
      },
    },
    aggs: {
      sample_docs: {
        top_hits: {
          size: 5,
        },
      },
    },
  });

  return { rawResponse: response, hasParent: response.hits.hits.length > 0 };
}
