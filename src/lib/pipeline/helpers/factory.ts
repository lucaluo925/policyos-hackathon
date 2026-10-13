/**
 * Pipeline factory — V6 wires in the reliable fetcher (retry + UA rotation +
 * classified failures) so every registered pipeline benefits without each
 * concrete pipeline having to reimplement it.
 */

import type {
  ClassifyInput,
  ClassifyResult,
  FetchResult,
  MatchedPolicy,
  ParsedSignal,
  PipelineDefinition,
  SourceContext,
} from '../framework';
import { extractHtmlSignal, normalizeHtml } from './html-extractor';
import { classifyShared } from './classifier';
import { matchExistingPolicy, type ExtendedMatch } from './matcher';
import { reliableFetch, type FailureType } from './fetcher';
import { prisma } from '@/lib/db/client';

export interface IndexPipelineConfig {
  key: string;
  label: string;
  canonicalSlug: string;
  defaultTitle: string;
  defaultSummary?: string;
  userAgent?: string;
  acceptHeader?: string;
  timeoutMs?: number;
  refine?: (input: ClassifyInput, signal: ParsedSignal) => Partial<ClassifyResult> | null;
}

/** Marker attached to `FetchResult` by the factory so the runner can persist
 *  a classified failureType when the pipeline's own fetch returns ok=false. */
export interface FailureAwareFetch extends FetchResult {
  failureType?: FailureType;
  retries?: number;
}

export function buildIndexPipeline(cfg: IndexPipelineConfig): PipelineDefinition {
  return {
    key: cfg.key,
    label: cfg.label,

    async fetch(ctx: SourceContext): Promise<FetchResult> {
      // V7: load fallback URLs from the MonitoredSource row (seeded from
      // PIPELINE_COVERAGE). When the primary URL fails, the reliable
      // fetcher walks the fallbacks in order.
      let fallbackUrls: string[] = [];
      try {
        const src = await prisma.monitoredSource.findUnique({
          where: { id: ctx.id },
          select: { fallbackUrls: true },
        });
        fallbackUrls = src?.fallbackUrls ?? [];
      } catch {
        /* non-fatal */
      }
      const result = await reliableFetch(ctx.sourceUrl, {
        timeoutMs: cfg.timeoutMs ?? 25_000,
        userAgent: cfg.userAgent,
        acceptHeader: cfg.acceptHeader,
        maxRetries: 2,
        fallbackUrls,
      });
      return result as FailureAwareFetch;
    },

    normalize(raw: string): string {
      return normalizeHtml(raw);
    },

    parse(normalized: string): ParsedSignal {
      return extractHtmlSignal(normalized, { summaryFallback: cfg.defaultSummary });
    },

    classifyChange(input: ClassifyInput): ClassifyResult {
      return classifyShared(input, input.currentSignal, {
        sourceLabel: cfg.label,
        refine: cfg.refine,
      });
    },

    async matchPolicy(ctx: SourceContext, signal: ParsedSignal): Promise<MatchedPolicy> {
      const ext: ExtendedMatch = await matchExistingPolicy(ctx, signal, {
        canonicalSlug: cfg.canonicalSlug,
        defaultTitle: cfg.defaultTitle,
        defaultSummary: cfg.defaultSummary,
      });
      return ext;
    },
  };
}
