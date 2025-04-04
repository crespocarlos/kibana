/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import { omit } from 'lodash';
import { RouteInitializerDeps } from '..';
import { CUSTOM_ELEMENT_TYPE, API_ROUTE_CUSTOM_ELEMENT } from '../../../common/lib/constants';
import { CustomElementUpdateSchema } from './custom_element_schema';
import { CustomElementAttributes } from './custom_element_attributes';
import { okResponse } from '../ok_response';
import { catchErrorHandler } from '../catch_error_handler';

export function initializeUpdateCustomElementRoute(deps: RouteInitializerDeps) {
  const { router } = deps;
  router.versioned
    .put({
      path: `${API_ROUTE_CUSTOM_ELEMENT}/{id}`,
      options: {
        body: {
          maxBytes: 26214400, // 25MB payload limit
          accepts: ['application/json'],
        },
      },
      access: 'internal',
      security: {
        authz: {
          enabled: false,
          reason:
            'This route is opted out from authorization because authorization is provided by saved objects client.',
        },
      },
    })
    .addVersion(
      {
        version: '1',
        validate: {
          request: {
            params: schema.object({
              id: schema.string(),
            }),
            body: CustomElementUpdateSchema,
          },
        },
      },
      catchErrorHandler(async (context, request, response) => {
        const payload = request.body;
        const id = request.params.id;

        const now = new Date().toISOString();
        const soClient = (await context.core).savedObjects.client;

        const customElementObject = await soClient.get<CustomElementAttributes>(
          CUSTOM_ELEMENT_TYPE,
          id
        );

        await soClient.create<CustomElementAttributes>(
          CUSTOM_ELEMENT_TYPE,
          {
            ...customElementObject.attributes,
            ...omit(payload, 'id'), // never write the id property
            '@timestamp': now,
            '@created': customElementObject.attributes['@created'], // ensure created is not modified
          },
          { overwrite: true, id }
        );

        return response.ok({
          body: okResponse,
        });
      })
    );
}
