/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';

import { mockTimelineData, TestProviders } from '../../../../../common/mock';
import { REASON_FIELD_NAME } from './constants';
import { reasonColumnRenderer } from './reason_column_renderer';
import { plainColumnRenderer } from './plain_column_renderer';

import type { ColumnHeaderOptions, RowRenderer } from '../../../../../../common/types';
import { RowRendererIdEnum } from '../../../../../../common/api/timeline';

import { render } from '@testing-library/react';
import { cloneDeep } from 'lodash';
import { TableId } from '@kbn/securitysolution-data-table';
import { defaultColumnHeaderType } from '../column_headers/default_headers';
jest.mock('./plain_column_renderer');

jest.mock('../../../../../common/components/link_to', () => {
  const original = jest.requireActual('../../../../../common/components/link_to');
  return {
    ...original,
    useFormatUrl: () => ({
      formatUrl: () => '',
    }),
  };
});

const invalidEcs = cloneDeep(mockTimelineData[0].ecs);
const validEcs = cloneDeep(mockTimelineData[28].ecs);

const field: ColumnHeaderOptions = {
  id: 'test-field-id',
  columnHeaderType: defaultColumnHeaderType,
};

const rowRenderers: RowRenderer[] = [
  {
    id: RowRendererIdEnum.alerts,
    isInstance: (ecs) => ecs === validEcs,
    renderRow: () => <span data-test-subj="test-row-render" />,
  },
];

const defaultProps = {
  columnName: REASON_FIELD_NAME,
  eventId: 'test-event-id',
  field,
  scopeId: 'test-timeline-id',
  values: ['test-value'],
};

describe('reasonColumnRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isIntance', () => {
    it('returns true when columnName is `signal.reason`', () => {
      expect(reasonColumnRenderer.isInstance(REASON_FIELD_NAME, [])).toBeTruthy();
    });
  });

  describe('renderColumn', () => {
    it('calls `plainColumnRenderer.renderColumn` when ecsData, or rowRenderers is empty', () => {
      reasonColumnRenderer.renderColumn(defaultProps);

      expect(plainColumnRenderer.renderColumn).toBeCalledTimes(1);
    });

    it("doesn't call `plainColumnRenderer.renderColumn` in expanded value when ecsData, or rowRenderers fields are not empty", () => {
      reasonColumnRenderer.renderColumn({
        ...defaultProps,
        isDetails: true,
        ecsData: invalidEcs,
        rowRenderers,
      });

      expect(plainColumnRenderer.renderColumn).toBeCalledTimes(0);
    });

    it('call `plainColumnRenderer.renderColumn` in cell value', () => {
      reasonColumnRenderer.renderColumn({
        ...defaultProps,
        isDetails: false,
        ecsData: invalidEcs,
        rowRenderers,
      });

      expect(plainColumnRenderer.renderColumn).toBeCalledTimes(1);
    });

    it("doesn't render reason renderers button when getRowRenderer doesn't find a rowRenderer", () => {
      const renderedColumn = reasonColumnRenderer.renderColumn({
        ...defaultProps,
        isDetails: true,
        ecsData: invalidEcs,
        rowRenderers,
      });

      const wrapper = render(<TestProviders>{renderedColumn}</TestProviders>);

      expect(wrapper.queryByTestId('reason-cell-button')).not.toBeInTheDocument();
    });

    it('render reason renderers when getRowRenderer finds a rowRenderer', () => {
      const renderedColumn = reasonColumnRenderer.renderColumn({
        ...defaultProps,
        isDetails: true,
        ecsData: validEcs,
        rowRenderers,
      });

      const wrapper = render(<TestProviders>{renderedColumn}</TestProviders>);

      expect(wrapper.queryByTestId('reason-cell-renderer')).toBeInTheDocument();
    });

    it("doesn't render reason renderers when timeline id is for the rule preview page", () => {
      const renderedColumn = reasonColumnRenderer.renderColumn({
        ...defaultProps,
        isDetails: true,
        ecsData: validEcs,
        rowRenderers,
        scopeId: TableId.rulePreview,
      });

      const wrapper = render(<TestProviders>{renderedColumn}</TestProviders>);

      expect(wrapper.queryByTestId('reason-cell-renderer')).not.toBeInTheDocument();
    });
  });
});
