/**
 * Singapore climate pipeline — Ministry of Sustainability and the Environment
 * (MSE) policies index.
 *
 * Source: https://www.mse.gov.sg/policies
 *
 * MSE is the lead ministry for Singapore's climate and environmental policy
 * (Carbon Tax Act, Singapore Green Plan, etc.). Its /policies index lists
 * the operative policies and amendments. We track it for structural change
 * signals and surface uncertain diffs to review.
 */

import { buildIndexPipeline } from '../helpers/factory';

export const singaporeClimatePipeline = buildIndexPipeline({
  key: 'singapore-climate',
  label: 'MSE Singapore — Climate & Environment Policies',
  canonicalSlug: 'mse-policies-index',
  defaultTitle: 'MSE Singapore — Policies Index',
  defaultSummary:
    "Index of Singapore's Ministry of Sustainability and the Environment policy pages (Carbon Tax, Green Plan, and related instruments).",
});
