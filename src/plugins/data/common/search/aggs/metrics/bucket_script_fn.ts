/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { i18n } from '@kbn/i18n';
import { Assign } from '@kbn/utility-types';
import { ExpressionFunctionDefinition } from '@kbn/expressions-plugin/common';
import { AggExpressionType, AggExpressionFunctionArgs, METRIC_TYPES } from '..';

export const bucketScriptFnName = 'bucketScript';

type Input = any;
type AggArgs = AggExpressionFunctionArgs<typeof METRIC_TYPES.BUCKET_SCRIPT>;
type Arguments = Assign<AggArgs, { customMetric?: AggExpressionType }>;
type Output = AggExpressionType;
type FunctionDefinition = ExpressionFunctionDefinition<
  typeof bucketScriptFnName,
  Input,
  Arguments,
  Output
>;

export const aggBucketScript = (): FunctionDefinition => ({
  name: bucketScriptFnName,
  help: i18n.translate('data.search.aggs.function.metrics.moving_avg.help', {
    defaultMessage: 'Generates a serialized agg config for a Moving Average agg',
  }),
  type: 'agg_type',
  args: {
    id: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.moving_avg.id.help', {
        defaultMessage: 'ID for this aggregation',
      }),
    },
    enabled: {
      types: ['boolean'],
      default: true,
      help: i18n.translate('data.search.aggs.metrics.moving_avg.enabled.help', {
        defaultMessage: 'Specifies whether this aggregation should be enabled',
      }),
    },
    schema: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.moving_avg.schema.help', {
        defaultMessage: 'Schema to use for this aggregation',
      }),
    },
    buckets_path: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.derivative.buckets_path.help', {
        defaultMessage: 'Path to the metric of interest',
      }),
    },
    script: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.moving_avg.script.help', {
        defaultMessage:
          'Id for finding agg config to use for building parent pipeline aggregations',
      }),
    },
    gap_policy: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.moving_avg.script.help', {
        defaultMessage:
          'Id for finding agg config to use for building parent pipeline aggregations',
      }),
    },
    customLabel: {
      types: ['string'],
      help: i18n.translate('data.search.aggs.metrics.moving_avg.customLabel.help', {
        defaultMessage: 'Represents a custom label for this aggregation',
      }),
    },
  },
  fn: (input, args) => {
    const { id, enabled, schema, ...rest } = args;

    return {
      type: 'agg_type',
      value: {
        id,
        enabled,
        schema,
        type: METRIC_TYPES.BUCKET_SCRIPT,
        params: {
          ...rest,
        },
      },
    };
  },
});
