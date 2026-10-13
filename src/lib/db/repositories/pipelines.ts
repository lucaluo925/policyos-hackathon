/**
 * Pipeline run repository.
 *
 * Every pipeline execution creates a row here, with a status that starts as
 * `partial` and is updated to `success` / `failed` when the run completes.
 * This lets the admin dashboard show runs-in-flight and surfaces crashed
 * runs that never wrote their final row.
 */

import type {
  ChangeClassification,
  PipelineRunStatus,
} from '@prisma/client';
import { prisma } from '../client';

export interface PipelineRunStart {
  pipelineKey: string;
  monitoredSourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function startRun(input: PipelineRunStart) {
  return prisma.pipelineRun.create({
    data: {
      pipelineKey: input.pipelineKey,
      monitoredSourceId: input.monitoredSourceId ?? null,
      status: 'partial',
      metadata: (input.metadata ?? {}) as object,
    },
  });
}

export interface PipelineRunEnd {
  id: string;
  status: PipelineRunStatus;
  changeDetected?: boolean;
  changeType?: ChangeClassification | null;
  summary?: string | null;
  errorMessage?: string | null;
  itemsProcessed?: number;
  itemsChanged?: number;
  itemsFlagged?: number;
  metadata?: Record<string, unknown>;
  // V6
  failureType?: string | null;
  retryCount?: number;
  deepItemsFetched?: number;
  deepItemsApplied?: number;
}

export async function endRun(input: PipelineRunEnd) {
  return prisma.pipelineRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      changeDetected: input.changeDetected ?? false,
      changeType: input.changeType ?? null,
      summary: input.summary ?? null,
      errorMessage: input.errorMessage ?? null,
      itemsProcessed: input.itemsProcessed ?? 0,
      itemsChanged: input.itemsChanged ?? 0,
      itemsFlagged: input.itemsFlagged ?? 0,
      failureType: input.failureType ?? null,
      retryCount: input.retryCount ?? 0,
      deepItemsFetched: input.deepItemsFetched ?? 0,
      deepItemsApplied: input.deepItemsApplied ?? 0,
      completedAt: new Date(),
      metadata: input.metadata != null ? (input.metadata as object) : undefined,
    },
  });
}

export async function listRecentRuns(filter?: {
  pipelineKey?: string;
  limit?: number;
}) {
  return prisma.pipelineRun.findMany({
    where: filter?.pipelineKey ? { pipelineKey: filter.pipelineKey } : {},
    orderBy: { startedAt: 'desc' },
    take: filter?.limit ?? 20,
    include: { monitoredSource: true },
  });
}

export async function getLastRunForSource(monitoredSourceId: string) {
  return prisma.pipelineRun.findFirst({
    where: { monitoredSourceId },
    orderBy: { startedAt: 'desc' },
  });
}
