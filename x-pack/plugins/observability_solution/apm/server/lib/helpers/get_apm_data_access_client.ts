/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ApmDataAccessClient, APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { MinimalAPMRouteHandlerResources } from '../../routes/apm_routes/register_apm_server_routes';

export async function getApmDataAccessClient({
  apmEventClient,
  plugins,
  context,
}: {
  apmEventClient: APMEventClient;
} & Pick<MinimalAPMRouteHandlerResources, 'plugins' | 'context'>): Promise<ApmDataAccessClient> {
  const coreContext = await context.core;
  const apmDataAccessPlugin = await plugins.apmDataAccess;

  return apmDataAccessPlugin.setup.getClient({
    apmEventClient,
    deps: {
      uiSettings: coreContext.uiSettings.client,
    },
  });
}
