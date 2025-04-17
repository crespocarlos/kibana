/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

// const { workerData } = require('piscina');

// You can now write your handler as an asynchronous function
const getWorkerHandler = () => {
  return ({ filename, input, signal }) => {
    // eslint-disable-next-line import/no-dynamic-require
    const worker = require(filename);
    return worker.run({
      filename,
      input,
      signal,
    });
  };
};

const initialize = getWorkerHandler();
module.exports = initialize;
