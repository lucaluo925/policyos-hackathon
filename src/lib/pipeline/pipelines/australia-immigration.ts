/**
 * Australia immigration pipeline — Department of Home Affairs visa news page.
 *
 * Source: https://immi.homeaffairs.gov.au/news-media/archive
 *
 * The archive of Home Affairs visa / migration program announcements. Index
 * changes indicate new announcements that may carry operational guidance.
 */

import { buildIndexPipeline } from '../helpers/factory';

export const australiaImmigrationPipeline = buildIndexPipeline({
  key: 'australia-immigration',
  label: 'Home Affairs AU — Visa News & Updates',
  canonicalSlug: 'home-affairs-visa-news',
  defaultTitle: 'Australia Home Affairs — Visa News Archive',
  defaultSummary:
    'Archive of Department of Home Affairs news covering visa, migration, and citizenship program updates.',
});
