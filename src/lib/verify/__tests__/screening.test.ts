import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preserveTopicalOfficialSource } from '../screening';

test('a same-topic Commission page survives a mistaken screening rejection', () => {
  const assertion = 'The EU CBAM declarant requirement applies regardless of import quantity.';
  assert.equal(preserveTopicalOfficialSource(assertion, {
    url: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en',
    title: 'CBAM definitive regime',
  }), true);
  assert.equal(preserveTopicalOfficialSource(assertion, {
    url: 'https://taxation-customs.ec.europa.eu/unrelated-battery-page',
    title: 'Battery passport implementation',
  }), false);
  assert.equal(preserveTopicalOfficialSource(assertion, {
    url: 'https://cbamguide.example.com/threshold',
    title: 'CBAM definitive regime',
  }), false);
});
