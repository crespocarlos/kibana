/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { EuiButtonEmpty } from '@elastic/eui';

interface NewBucketButtonProps {
  label: string;
  onClick: () => void;
  isDisabled?: boolean;
  'data-test-subj'?: string;
}

export const NewBucketButton = ({
  label,
  onClick,
  isDisabled,
  'data-test-subj': dataTestSubj = 'lns-newBucket-add',
}: NewBucketButtonProps) => (
  <EuiButtonEmpty
    data-test-subj={dataTestSubj}
    size="xs"
    iconType="plusInCircle"
    onClick={onClick}
    isDisabled={isDisabled}
    flush="left"
  >
    {label}
  </EuiButtonEmpty>
);
