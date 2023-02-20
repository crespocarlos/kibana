/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { i18n } from '@kbn/i18n';
import { MetricAggType } from './metric_agg_type';
import { makeNestedLabel } from './lib/make_nested_label';
import { METRIC_TYPES } from './metric_agg_types';
import { AggConfigSerialized, BaseAggParams, IAggConfig } from '../types';
import { bucketScriptFnName } from './bucket_script_fn';

export interface CommonAggParamsBucketScriptAgg extends BaseAggParams {
  buckets_path?: string;
  gap_policy?: string;
  script?: string;
}

export interface AggParamsBucketScriptSerialized extends CommonAggParamsBucketScriptAgg {
  customMetric?: AggConfigSerialized;
}

export interface AggParamsBucketScript extends CommonAggParamsBucketScriptAgg {
  customMetric?: IAggConfig;
}

const bucketScriptTitle = i18n.translate('data.search.aggs.metrics.movingAvgTitle', {
  defaultMessage: 'Bucket Script',
});

const bucketScriptLabel = i18n.translate('data.search.aggs.metrics.movingAvgLabel', {
  defaultMessage: 'bucket script',
});

export const getBucketScriptMetricAgg = () => {
  return new MetricAggType({
    name: METRIC_TYPES.BUCKET_SCRIPT,
    expressionName: bucketScriptFnName,
    title: bucketScriptTitle,
    makeLabel: (agg) => makeNestedLabel(agg, bucketScriptLabel),
    params: [
      {
        name: 'buckets_path',
        write: (agg, output) => {
          output.params.buckets_path = agg.params.buckets_path;
        },
      },
      {
        name: 'script',
        write: (agg, output) => {
          output.params.script = agg.params.script;
        },
      },
      {
        name: 'gap_policy',
        write: (agg, output) => {
          output.params.gap_policy = agg.params.gap_policy;
        },
      },
    ],
    getValue(agg, bucket) {
      /**
       * The previous implementation using `moving_avg` did not
       * return any bucket in case there are no documents or empty window.
       * The `moving_fn` aggregation returns buckets with the value null if the
       * window is empty or doesn't return any value if the sibiling metric
       * is null. Since our generic MetricAggType.getValue implementation
       * would return the value 0 for null buckets, we need a specific
       * implementation here, that preserves the null value.
       */
      return bucket[agg.id] ? bucket[agg.id].value : null;
    },
  });
};
