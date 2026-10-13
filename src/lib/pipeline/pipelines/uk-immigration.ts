/**
 * UK immigration pipeline — GOV.UK Immigration Rules index.
 *
 * Source: https://www.gov.uk/guidance/immigration-rules
 *
 * The Immigration Rules index is the operational document UK Visas & Immigration
 * uses as the live rulebook. Changes to its listing (HC statements added,
 * chapters amended) are the signal we monitor. A separate RSS feed provides
 * the human-friendly news view — see src/lib/feeds/ingestion.ts.
 */

import { buildIndexPipeline } from '../helpers/factory';

export const ukImmigrationPipeline = buildIndexPipeline({
  key: 'uk-immigration',
  label: 'GOV.UK — Immigration Rules',
  canonicalSlug: 'govuk-immigration-rules',
  defaultTitle: 'UK Immigration Rules',
  defaultSummary:
    'Live index of the UK Immigration Rules and supplementary HC statements. Changes indicate new or amended operational guidance.',
});
