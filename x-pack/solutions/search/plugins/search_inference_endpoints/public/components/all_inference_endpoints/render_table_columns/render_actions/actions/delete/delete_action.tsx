/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { InferenceInferenceEndpointInfo } from '@elastic/elasticsearch/lib/api/types';
import { useDeleteEndpoint } from '../../../../../../hooks/use_delete_endpoint';
import { ConfirmDeleteEndpointModal } from './confirm_delete_endpoint';

interface DeleteActionProps {
  selectedEndpoint: InferenceInferenceEndpointInfo;
  onCancel: () => void;
  displayModal: boolean;
}

export const DeleteAction: React.FC<DeleteActionProps> = ({
  selectedEndpoint,
  onCancel,
  displayModal,
}) => {
  const { mutate: deleteEndpoint } = useDeleteEndpoint(onCancel);

  const onConfirmDeletion = () => {
    if (!selectedEndpoint) {
      return;
    }

    deleteEndpoint({
      type: selectedEndpoint.task_type,
      id: selectedEndpoint.inference_id,
    });
  };

  return (
    <>
      {displayModal ? (
        <ConfirmDeleteEndpointModal
          onCancel={onCancel}
          onConfirm={onConfirmDeletion}
          inferenceEndpoint={selectedEndpoint}
        />
      ) : null}
    </>
  );
};
