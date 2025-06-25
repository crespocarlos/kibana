/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { from } from './from';
import { stats } from './stats';

describe('stats', () => {
  const source = from('logs-*');

  it('handles a basic STATS command', () => {
    const pipeline = source.pipe(
      stats('avg_duration = AVG(transaction.duration.us) BY service.name')
    );

    expect(pipeline.asString()).toEqual(
      'FROM `logs-*`\n  | STATS avg_duration = AVG(transaction.duration.us) BY service.name'
    );
  });

  it('handles STATS with params', () => {
    const pipeline = source.pipe(
      stats('AVG(??duration), COUNT(??svcName) WHERE agent.name == "java" BY ??env', {
        duration: 'transaction.duration.us',
        svcName: 'service.name',
        env: 'service.environment',
      })
    );
    const queryRequest = pipeline.asRequest();

    expect(queryRequest.query).toEqual(
      'FROM `logs-*`\n  | STATS AVG(??duration), COUNT(??svcName) WHERE agent.name == "java" BY ??env'
    );
    expect(queryRequest.params).toEqual([
      {
        duration: 'transaction.duration.us',
      },
      {
        svcName: 'service.name',
      },
      {
        env: 'service.environment',
      },
    ]);
    expect(pipeline.asString()).toEqual(
      'FROM `logs-*`\n  | STATS AVG(`transaction.duration.us`), COUNT(`service.name`) WHERE agent.name == "java" BY `service.environment`'
    );
  });
});
