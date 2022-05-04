/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import {
  Project,
  Node,
  SourceFile,
  SyntaxKind,
  PropertyAccessExpression,
  MethodDeclaration,
  ObjectLiteralExpression,
  ExportedDeclarations,
} from 'ts-morph';
import { __values } from 'tslib';
import { Analyzer } from './types';

export const infraPluginHttpRouteAnalyzer: Analyzer = {
  name: 'InfraPluginHttpRouteAnalyzer',
  async apply(pluginProject) {
    const serverDirectory = getScopeDirectory(pluginProject, 'server');
    const serverIndexFile = serverDirectory.getSourceFileOrThrow('index.ts');
    const pluginFactory = serverIndexFile.getExportedDeclarations().get('plugin')?.[0];

    if (Node.isFunctionLikeDeclaration(pluginFactory)) {
      const pluginClassType = pluginFactory.getReturnType();
      const pluginClass = pluginClassType.getSymbol()?.getDeclarations()[0];
      const pluginClassFile = pluginClass?.getSourceFile();
      findRouteRegister(pluginClassFile);
    }

    return {
      features: [],
      errors: [],
    };
  },
};

function findRouteRegister(file: SourceFile | undefined, visitedSources: string[] = []) {
  if (!file) {
    throw new Error('source file is undefined');
  }

  const dependencies = getScopeDependencies(file, 'infra');

  for (const dependency of dependencies) {
    const validExportedDeclarations = new Map(
      Object.entries(
        [...dependency.getExportedDeclarations()].reduce(
          (acc, [k, v]) => ({
            ...acc,
            [k]: v.filter((p) => Node.isVariableDeclaration(p)),
          }),
          {} as Record<string, ExportedDeclarations[]>
        )
      )
    );

    for (const [_exportName, items] of validExportedDeclarations) {
      const functionStatements = items.flatMap((exportedItem) =>
        // TODO: doesn't cover function declaration
        exportedItem.getDescendantsOfKind(SyntaxKind.ArrowFunction)
      );

      for (const func of functionStatements) {
        // gets calls within the function scope
        const calls = func.getDescendantsOfKind(SyntaxKind.CallExpression);

        const propAccessesExpressions = calls.map(
          (call) => call.getExpression() as PropertyAccessExpression
        );

        for (const propAccess of propAccessesExpressions) {
          if (propAccess && 'getNameNode' in propAccess) {
            // copied from https://github.com/dsherret/ts-morph/issues/802
            const methodNameIdent = propAccess.getNameNode();
            const methodSymbol = methodNameIdent.getSymbol();
            if (!!methodSymbol) {
              const methodDec = methodSymbol.getDeclarations()[0] as MethodDeclaration;
              // TODO: if the function name is changed, this will stop working. Find a better way
              if (methodDec.getName() === 'registerRoute') {
                const tss = calls[0].getArguments()[0] as ObjectLiteralExpression;
                // eslint-disable-next-line no-console
                console.log(
                  `${dependency.getDirectoryPath()}/${dependency.getBaseName()} ->`,
                  tss.getText()
                );
              }
            }
          }
        }
      }
    }

    if (!visitedSources.includes(`${dependency.getDirectoryPath()}/${dependency.getBaseName()}`)) {
      visitedSources.push(`${dependency.getDirectoryPath()}/${dependency.getBaseName()}`);
      findRouteRegister(dependency, visitedSources);
    }
  }
}

function getScopeDependencies(file: SourceFile | undefined, pluginName: 'infra' | 'monitoring') {
  if (!file) {
    throw new Error('source file is undefined');
  }

  return file.getReferencedSourceFiles().filter((sf) => sf.getDirectoryPath().includes(pluginName));
}

function getScopeDirectory(pluginProject: Project, apiScope: 'common' | 'public' | 'server') {
  const scopeDirectory = pluginProject
    .getRootDirectories()
    .find((rootDirectory) => rootDirectory.getBaseName() === apiScope);

  if (scopeDirectory == null) {
    throw new Error(`Failed to find the directory for scope ${apiScope}`);
  }

  return scopeDirectory;
}
