/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { type CloudProvider, CloudProviderIcon, AgentIcon } from '@kbn/custom-icons';
import { EuiFlexGroup, EuiFlexItem, EuiIcon } from '@elastic/eui';
import type { AgentName } from '@kbn/elastic-agent-utils';
import { euiThemeVars } from '@kbn/ui-theme';
import type { InventoryEntityLatest } from '../../../common/entities';

interface EntityIconProps {
  entity: InventoryEntityLatest;
}

type NotNullableCloudProvider = Exclude<CloudProvider, null>;

const getSingleValue = <T,>(value?: T | T[] | null): T | undefined => {
  return value == null ? undefined : Array.isArray(value) ? value[0] : value;
};

export function EntityIcon({ entity }: EntityIconProps) {
  const entityType = entity.entity.type;
  const defaultIconSize = euiThemeVars.euiSizeL;

  switch (entityType) {
    case 'host':
    case 'container': {
      const cloudProvider = getSingleValue(
        entity.cloud?.provider as NotNullableCloudProvider | NotNullableCloudProvider[]
      );
      return (
        <EuiFlexGroup
          style={{ width: defaultIconSize, height: defaultIconSize }}
          alignItems="center"
          justifyContent="center"
        >
          <EuiFlexItem grow={false}>
            <CloudProviderIcon
              cloudProvider={cloudProvider}
              size="m"
              title={cloudProvider}
              role="presentation"
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      );
    }
    case 'service': {
      const agentName = getSingleValue(entity.agent?.name as AgentName | AgentName[]);
      return <AgentIcon agentName={agentName} role="presentation" />;
    }
    default:
      // Return an empty EuiIcon instead of null to maintain UI alignment across all EntityIcon usages
      return <EuiIcon type="" size="l" />;
  }
}
