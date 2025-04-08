/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { tableFromIPC } from 'apache-arrow';

interface Column {
  name: string;
  type: string;
}

interface ColumnarResult {
  columns: Column[];
  values: any[][];
}

export function esqlArrowResultToColumnar(buffer: ArrayBuffer | SharedArrayBuffer): ColumnarResult {
  const uint8 = new Uint8Array(buffer);
  const table = tableFromIPC(uint8);

  const columns: Column[] = [];
  const values: any[][] = [];

  for (const field of table.schema.fields) {
    const child = table.getChild(field.name);
    if (!child) {
      continue;
    }

    const currentValues = [];
    for (let i = 0; i < table.numRows; i++) {
      const value = child.get(i);
      if (typeof value === 'bigint') {
        currentValues.push(Number(value));
      } else {
        currentValues.push(value);
      }
    }

    if (currentValues.length > 0) {
      columns.push({ name: field.name, type: field.type.toString() });
      values.push(currentValues);
    }
  }

  return {
    columns,
    values,
  };
}
