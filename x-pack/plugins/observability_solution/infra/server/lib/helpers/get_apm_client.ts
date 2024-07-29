/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ApmDataAccessPluginSetup, APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { KibanaRequest } from '@kbn/core/server';
import { InfraPluginRequestHandlerContext } from '../../types';

export const getApmDataAccessClient = async ({
  apmDataAccess,
  requestContext,
  request,
}: {
  apmDataAccess: ApmDataAccessPluginSetup;
  requestContext: InfraPluginRequestHandlerContext;
  request: KibanaRequest;
}) => {
  const coreContext = await requestContext.core;
  const savedObjectsClient = coreContext.savedObjects.client;
  const apmIndices = await apmDataAccess.getApmIndices(savedObjectsClient);
  const esClient = coreContext.elasticsearch.client.asCurrentUser;

  return apmDataAccess.getClient({
    apmEventClient: new APMEventClient({
      indices: apmIndices,
      options: {
        includeFrozen: false,
      },
      debug: false,
      esClient,
      request,
    }),
    deps: {
      uiSettings: coreContext.uiSettings.client,
    },
  });
};
