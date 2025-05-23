/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */
import chalk from 'chalk';
import { relative } from 'path';
import { REPO_ROOT } from '@kbn/repo-info';
import { createAssignmentProxy } from './assignment_proxy';
import { wrapFunction } from './wrap_function';
import { wrapRunnableArgs } from './wrap_runnable_args';

// Add a global configuration for pauseOnError
const testConfig = {
  pauseOnError: process.argv.includes('--pauseOnError'),
};

const allTestsSkippedCache = new WeakMap();
function allTestsAreSkipped(suite) {
  // cache result for each suite so we don't have to traverse over and over
  const cache = allTestsSkippedCache.get(suite);
  if (cache) {
    return cache;
  }

  // if this suite is skipped directly then all it's children are skipped
  if (suite.pending) {
    allTestsSkippedCache.set(suite, true);
    return true;
  }

  // if any of this suites own tests are not skipped, then we don't need to traverse to child suites
  if (suite.tests.some((t) => !t.pending)) {
    allTestsSkippedCache.set(suite, false);
    return false;
  }

  // otherwise traverse down through the child suites and return true only if all children are all skipped
  const childrenSkipped = suite.suites.every(allTestsAreSkipped);
  allTestsSkippedCache.set(suite, childrenSkipped);
  return childrenSkipped;
}

function createErrorPauseHandler() {
  return async (err, test, callback) => {
    // Check if pauseOnError is enabled globally or for this specific test
    if (testConfig.pauseOnError) {
      const originalTimeout = test.timeout();
      // Set minimum pause timeout to 10 minutes (600000 ms)
      const minPauseTimeout = 600000;
      // Extend timeout if it's less than 10 minutes
      if (originalTimeout < minPauseTimeout) {
        test.timeout(minPauseTimeout);
      }

      // Create a more informative pause message
      const pauseMessage = chalk.bold.yellow(`
        !!!!! ${chalk.red('TEST PAUSED ON ERROR')} !!!!!
        ${chalk.blue('File:')} ${test.file}
        ${chalk.blue('Test:')} ${test.title}
        ${chalk.red('Error:')} ${err.message}

        ${chalk.yellow('Pausing test execution. Press Ctrl+C to exit.')}

      `);

      // Use console.error to ensure the message is visible
      console.error(pauseMessage);

      return new Promise((resolve) => {
        // Set a timeout to automatically resume after 10 minutes
        const pauseTimeout = setTimeout(() => {
          console.error('Pause timeout exceeded. Resuming test execution.');
          resolve();
          // Restore the original timeout
          test.timeout(originalTimeout);
          // Clear the timeout to prevent memory leaks
          clearTimeout(pauseTimeout);

          // call the callback to continue the test run
          callback();
        }, minPauseTimeout);

        // Set up a way to manually interrupt
        const interruptHandler = () => {
          clearTimeout(pauseTimeout);
          console.error(chalk.bold.red('\nTest run interrupted by user.'));
          process.exit(1);
        };

        // Attach the interrupt handler
        process.once('SIGINT', interruptHandler);
      });
    }

    // Always trigger the existing test failure lifecycle hook
    await callback();
  };
}

/**
 * @param {import('../lifecycle').Lifecycle} lifecycle
 * @param {any} context
 * @param {{ rootTags?: string[] }} options
 */
export function decorateMochaUi(lifecycle, context, { rootTags }) {
  // incremented at the start of each suite, decremented after
  // so that in each non-suite call we can know if we are within
  // a suite, or that when a suite is defined it is within a suite
  let suiteLevel = 0;

  // incremented at the start of each suite, used to know when a
  // suite is not the first suite
  let suiteCount = 0;

  // Create a error pause handler specific to this lifecycle
  const errorPauseHandler = createErrorPauseHandler(lifecycle);

  /**
   *  Wrap the describe() function in the mocha UI to ensure
   *  that the first call made when defining a test file is a
   *  "describe()", and that there is only one describe call at
   *  the top level of that file.
   *
   *  @param  {String} name
   *  @param  {Function} fn
   *  @return {Function}
   */
  function wrapSuiteFunction(name, fn) {
    return wrapFunction(fn, {
      before(target, thisArg, argumentsList) {
        if (suiteCount > 0 && suiteLevel === 0) {
          throw new Error(`
            Test files must only define a single top-level suite. Please ensure that
            all calls to \`describe()\` are within a single \`describe()\` call in this file.
          `);
        }

        const [name, provider] = argumentsList;
        if (typeof name !== 'string' || typeof provider !== 'function') {
          throw new Error(`Unexpected arguments to ${name}(${argumentsList.join(', ')})`);
        }

        argumentsList[1] = function () {
          before('beforeTestSuite.trigger', async () => {
            await lifecycle.beforeTestSuite.trigger(this);
          });

          const relativeFilePath = relative(REPO_ROOT, this.file);
          this._tags = [
            relativeFilePath,
            // we attach the "root tags" to all the child suites of the root suite, so that if they
            // need to be excluded they can be removed from the root suite without removing the entire
            // root suite
            ...(this.parent.root ? [...(rootTags ?? [])] : []),
          ];
          this.suiteTag = relativeFilePath; // The tag that uniquely targets this suite/file
          this.tags = (tags) => {
            const tagsToAdd = Array.isArray(tags) ? tags : [tags];
            this._tags = [...this._tags, ...tagsToAdd];
          };
          this.onlyEsVersion = (semver) => {
            this._esVersionRequirement = semver;
          };

          provider.call(this);

          if (allTestsAreSkipped(this)) {
            // all the children in this suite are skipped, so make sure the suite is
            // marked as pending so that its hooks are not run
            this.pending = true;
          }

          after('afterTestSuite.trigger', async () => {
            await lifecycle.afterTestSuite.trigger(this);
          });
        };

        suiteCount += 1;
        suiteLevel += 1;
      },
      after() {
        suiteLevel -= 1;
      },
    });
  }

  /**
   *  Wrap test functions to emit "testFailure" lifecycle hooks
   *  when they fail and throw when they are called outside of
   *  a describe
   *
   *  @param  {String} name
   *  @param  {Function} fn
   *  @return {Function}
   */
  function wrapTestFunction(name, fn) {
    return wrapNonSuiteFunction(
      name,
      wrapRunnableArgs(fn, lifecycle, async (err, test) => {
        await errorPauseHandler(err, test, async () => {
          await lifecycle.testFailure.trigger(err, test);
        });
      })
    );
  }

  /**
   *  Wrap test hook functions to emit "testHookFailure" lifecycle
   *  hooks when they fail and throw when they are called outside
   *  of a describe
   *
   *  @param  {String} name
   *  @param  {Function} fn
   *  @return {Function}
   */
  function wrapTestHookFunction(name, fn) {
    return wrapNonSuiteFunction(
      name,
      wrapRunnableArgs(fn, lifecycle, async (err, test) => {
        await errorPauseHandler(err, test, async () => {
          await lifecycle.testHookFailure.trigger(err, test);
        });
      })
    );
  }

  /**
   *  Wrap all non describe() mocha ui functions to ensure
   *  that they are not called outside of a describe block
   *
   *  @param  {String} name
   *  @param  {Function} fn
   *  @return {Function}
   */
  function wrapNonSuiteFunction(name, fn) {
    return wrapFunction(fn, {
      before() {
        if (suiteLevel === 0) {
          throw new Error(`
            All ${name}() calls in test files must be within a describe() call.
          `);
        }
      },
    });
  }

  /**
   *  called for every assignment while defining the mocha ui
   *  and can return an alternate value that will be used for that
   *  assignment
   *
   *  @param  {String} property
   *  @param  {Any} value
   *  @return {Any} replacement function
   */
  function assignmentInterceptor(property, value) {
    if (typeof value !== 'function') {
      return value;
    }

    value = createAssignmentProxy(value, (subProperty, subValue) => {
      return assignmentInterceptor(`${property}.${subProperty}`, subValue);
    });

    switch (property) {
      case 'describe':
      case 'describe.only':
      case 'describe.skip':
      case 'xdescribe':
      case 'context':
      case 'context.only':
      case 'context.skip':
      case 'xcontext':
        return wrapSuiteFunction(property, value);

      case 'it':
      case 'it.only':
      case 'it.skip':
      case 'xit':
      case 'specify':
      case 'specify.only':
      case 'specify.skip':
      case 'xspecify':
        return wrapTestFunction(property, value);

      case 'before':
      case 'beforeEach':
      case 'after':
      case 'afterEach':
      case 'run':
        return wrapTestHookFunction(property, value);

      default:
        return wrapNonSuiteFunction(property, value);
    }
  }

  return createAssignmentProxy(context, assignmentInterceptor);
}
