/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { tableFromIPC } from 'apache-arrow';

export function esqlArrowResultToJson<
  TDocument extends Record<string, any> = Record<string, unknown>
>(buffer: ArrayBuffer | SharedArrayBuffer): TDocument[] {
  const uint8 = new Uint8Array(buffer);
  const table = tableFromIPC(uint8);

  const response: TDocument[] = [];

  for (let i = 0; i < table.numRows; i++) {
    const row = table.schema.fields.reduce<TDocument>((acc, field) => {
      const child = table.getChild(field.name);
      if (!child) {
        return acc;
      }
      const value = child.get(i);

      acc[field.name as keyof TDocument] = value;

      return acc;
    }, {} as TDocument);

    response.push(row);
  }

  return response;
}
