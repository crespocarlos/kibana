/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../../../../../ftr_provider_context';

export default ({ loadTestFile }: FtrProviderContext): void => {
  describe('Rules Management - Prebuilt Rules - Prebuilt Rule Customization Enabled', function () {
    loadTestFile(require.resolve('./is_customized_calculation'));
    loadTestFile(require.resolve('./import_rules'));
    loadTestFile(require.resolve('./rules_export'));
    loadTestFile(require.resolve('./rule_customization'));
    loadTestFile(require.resolve('./preview_prebuilt_rules_upgrade'));
    loadTestFile(require.resolve('./upgrade_prebuilt_rules'));
  });
};
