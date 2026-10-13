/**
 * Pipeline registry.
 *
 * Maps `pipelineKey` (stored on MonitoredSource.pipelineKey) to a concrete
 * PipelineDefinition. Adding a new pipeline requires:
 *   1. Create a file in `src/lib/pipeline/pipelines/<name>.ts` that exports
 *      a PipelineDefinition (usually via `buildIndexPipeline()`).
 *   2. Register it here.
 *   3. Seed a MonitoredSource row via PIPELINE_COVERAGE.
 */

import type { PipelineDefinition } from './framework';
import { canadaImmigrationPipeline } from './pipelines/canada-immigration';
import { usImmigrationPipeline } from './pipelines/us-immigration';
import { ukImmigrationPipeline } from './pipelines/uk-immigration';
import { singaporeClimatePipeline } from './pipelines/singapore-climate';
import { australiaImmigrationPipeline } from './pipelines/australia-immigration';
// V5
import { euTradePipeline } from './pipelines/eu-trade';
import { japanTradePipeline } from './pipelines/japan-trade';
import { koreaTradePipeline } from './pipelines/korea-trade';
import { germanyClimatePipeline } from './pipelines/germany-climate';
import { ukClimatePipeline } from './pipelines/uk-climate';
import { franceClimatePipeline } from './pipelines/france-climate';
import { indiaImmigrationPipeline } from './pipelines/india-immigration';
import { brazilMigrationPipeline } from './pipelines/brazil-migration';

const allPipelines: PipelineDefinition[] = [
  canadaImmigrationPipeline,
  usImmigrationPipeline,
  ukImmigrationPipeline,
  singaporeClimatePipeline,
  australiaImmigrationPipeline,
  euTradePipeline,
  japanTradePipeline,
  koreaTradePipeline,
  germanyClimatePipeline,
  ukClimatePipeline,
  franceClimatePipeline,
  indiaImmigrationPipeline,
  brazilMigrationPipeline,
];

export const pipelineRegistry: Record<string, PipelineDefinition> = Object.fromEntries(
  allPipelines.map((p) => [p.key, p]),
);

export function getPipeline(key: string): PipelineDefinition | null {
  return pipelineRegistry[key] ?? null;
}

export function listPipelines(): PipelineDefinition[] {
  return allPipelines;
}
