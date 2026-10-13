/**
 * France climate pipeline — Ministère de la Transition Écologique press room.
 *
 * Source: https://www.ecologie.gouv.fr/presse
 */
import { buildIndexPipeline } from '../helpers/factory';

export const franceClimatePipeline = buildIndexPipeline({
  key: 'france-climate',
  label: 'France — Transition Écologique press',
  canonicalSlug: 'france-mte-press',
  defaultTitle: 'France — Ministère de la Transition Écologique press',
  defaultSummary:
    'Press releases from the French Ministry for Ecological Transition — climate, biodiversity, energy transition policy.',
});
