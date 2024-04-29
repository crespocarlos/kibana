/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import type { LazyObservabilityPageTemplateProps } from '@kbn/observability-shared-plugin/public';
import type { NoDataConfig } from '@kbn/shared-ux-page-kibana-template';
import React, { useEffect } from 'react';
import {
  noMetricIndicesPromptDescription,
  noMetricIndicesPromptPrimaryActionTitle,
  NoRemoteCluster,
} from '../../components/empty_states';
import { SourceErrorPage } from '../../components/source_error_page';
import { SourceLoadingPage } from '../../components/source_loading_page';
import { useSourceContext } from '../../containers/metrics_source';
import { useKibanaContextForPlugin } from '../../hooks/use_kibana';

export const MetricsPageTemplate: React.FC<LazyObservabilityPageTemplateProps> = ({
  'data-test-subj': _dataTestSubj,
  ...pageTemplateProps
}) => {
  const {
    services: {
      observabilityAIAssistant,
      observabilityShared: {
        navigation: { PageTemplate },
      },
      docLinks,
    },
  } = useKibanaContextForPlugin();

  const { source, error, loadSource, isLoading } = useSourceContext();
  const { remoteClustersExist, metricIndicesExist } = source?.status ?? {};

  const noDataConfig: NoDataConfig | undefined = metricIndicesExist
    ? undefined
    : {
        solution: i18n.translate('xpack.infra.metrics.noDataConfig.solutionName', {
          defaultMessage: 'Observability',
        }),
        action: {
          beats: {
            title: noMetricIndicesPromptPrimaryActionTitle,
            description: noMetricIndicesPromptDescription,
          },
        },
        docsLink: docLinks.links.observability.guide,
      };

  const { setScreenContext } = observabilityAIAssistant?.service || {};

  useEffect(() => {
    return setScreenContext?.({
      data: [
        {
          name: 'Metrics configuration',
          value: source,
          description: 'The configuration of the Metrics app',
        },
      ],
      starterPrompts: [
        ...(!metricIndicesExist
          ? [
              {
                title: i18n.translate(
                  'xpack.infra.metrics.aiAssistant.starterPrompts.explainNoData.title',
                  {
                    defaultMessage: 'Explain',
                  }
                ),
                prompt: i18n.translate(
                  'xpack.infra.metrics.aiAssistant.starterPrompts.explainNoData.prompt',
                  {
                    defaultMessage: "Why don't I see any data?",
                  }
                ),
                icon: 'sparkles',
              },
            ]
          : []),
      ],
    });
  }, [metricIndicesExist, setScreenContext, source]);

  if (isLoading && !source) return <SourceLoadingPage />;

  if (!remoteClustersExist) {
    return <NoRemoteCluster />;
  }

  if (error) {
    <SourceErrorPage errorMessage={error} retry={loadSource} />;
  }

  return (
    <PageTemplate
      data-test-subj={metricIndicesExist ? _dataTestSubj : 'noDataPage'}
      noDataConfig={noDataConfig}
      {...pageTemplateProps}
    />
  );
};
