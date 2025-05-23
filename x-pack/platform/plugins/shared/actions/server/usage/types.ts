/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { MakeSchemaFrom } from '@kbn/usage-collection-plugin/server';

export interface ActionsUsage {
  has_errors: boolean;
  error_messages?: string[];
  alert_history_connector_enabled: boolean;
  count_total: number;
  count_by_type: Record<string, number>;
  count_gen_ai_provider_types: Record<string, number>;
  count_active_total: number;
  count_active_alert_history_connectors: number;
  count_active_by_type: Record<string, number>;
  count_active_email_connectors_by_service_type: Record<string, number>;
  count_actions_namespaces: number;
  count_actions_executions_per_day: number;
  count_actions_executions_by_type_per_day: Record<string, number>;
  count_actions_executions_failed_per_day: number;
  count_actions_executions_failed_by_type_per_day: Record<string, number>;
  count_connector_types_by_action_run_outcome_per_day: Record<string, Record<string, number>>;
  avg_execution_time_per_day: number;
  avg_execution_time_by_type_per_day: Record<string, number>;
}

export const byTypeSchema: MakeSchemaFrom<ActionsUsage>['count_by_type'] = {
  // TODO: Find out an automated way to populate the keys or reformat these into an array (and change the Remote Telemetry indexer accordingly)
  DYNAMIC_KEY: { type: 'long' },
  // Known actions:
  __email: { type: 'long' },
  __index: { type: 'long' },
  ['__gen-ai']: { type: 'long' },
  __pagerduty: { type: 'long' },
  __swimlane: { type: 'long' },
  '__server-log': { type: 'long' },
  __slack: { type: 'long' },
  __webhook: { type: 'long' },
  __servicenow: { type: 'long' },
  __jira: { type: 'long' },
  __resilient: { type: 'long' },
  __teams: { type: 'long' },
};

export const byGenAiProviderTypeSchema: MakeSchemaFrom<ActionsUsage>['count_by_type'] = {
  DYNAMIC_KEY: { type: 'long' },
  // Known providers:
  ['Azure OpenAI']: { type: 'long' },
  ['OpenAI']: { type: 'long' },
  ['Other']: { type: 'long' },
};

export const byServiceProviderTypeSchema: MakeSchemaFrom<ActionsUsage>['count_active_email_connectors_by_service_type'] =
  {
    DYNAMIC_KEY: { type: 'long' },
    // Known services:
    exchange_server: { type: 'long' },
    gmail: { type: 'long' },
    outlook365: { type: 'long' },
    elastic_cloud: { type: 'long' },
    other: { type: 'long' },
    ses: { type: 'long' },
  };

export interface ConnectorUsageReport {
  id: string;
  usage_timestamp: string;
  creation_timestamp: string;
  usage: {
    type: string;
    period_seconds: number;
    quantity: number | string | undefined;
  };
  source: {
    id: string | undefined;
    instance_group_id: string;
  };
}
