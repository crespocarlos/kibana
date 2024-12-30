/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { from } from './commands/from';
import { keep } from './commands/keep';
import { SortOrder, sort } from './commands/sort';
import { stats } from './commands/stats';
import { where } from './commands/where';

describe('composer', () => {
  const source = from('logs-*');

  it('applies operators in order', () => {
    const pipeline = source.pipe(
      where(`@timestamp <= NOW() AND @timestamp > NOW() - 24 hours`),
      stats(`avg_duration = AVG(transaction.duration.us) BY service.name`),
      keep('@timestamp', 'avg_duration', 'service.name'),
      sort('avg_duration', { '@timestamp': SortOrder.Desc })
    );

    expect(pipeline.asString()).toEqual(
      'FROM `logs-*`\n\t| WHERE @timestamp <= NOW() AND @timestamp > NOW() - 24 hours\n\t| STATS avg_duration = AVG(transaction.duration.us) BY service.name\n\t| KEEP `@timestamp`, `avg_duration`, `service.name`\n\t| SORT `avg_duration` ASC, `@timestamp` DESC'
    );
  });
});
