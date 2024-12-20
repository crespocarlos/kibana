/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { lazy, Suspense } from 'react';
import { EuiLoadingSpinner } from '@elastic/eui';

const EnablementModalCalloutLazy = lazy(() => import('./enablement_modal_callout'));

export const EnablementModalCallout = () => (
  <Suspense fallback={<EuiLoadingSpinner size="s" />}>
    <EnablementModalCalloutLazy />
  </Suspense>
);
