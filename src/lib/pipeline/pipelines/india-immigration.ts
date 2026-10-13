/**
 * India immigration pipeline — Ministry of Home Affairs (MHA) immigration page.
 *
 * Source: https://www.mha.gov.in/en/commoncontent/immigration
 */
import { buildIndexPipeline } from '../helpers/factory';

export const indiaImmigrationPipeline = buildIndexPipeline({
  key: 'india-immigration',
  label: 'India MHA — Immigration',
  canonicalSlug: 'mha-immigration',
  defaultTitle: 'India Ministry of Home Affairs — Immigration',
  defaultSummary:
    "India MHA's Immigration section — visa, Bureau of Immigration, OCI, and FRRO policies.",
});
