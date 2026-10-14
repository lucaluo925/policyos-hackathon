'use client';

/**
 * /verify — check one claim about policy against live sources.
 *
 * The page is a view of the pipeline's event stream, not a progress animation:
 * every row that appears corresponds to something that actually happened, and
 * the evidence shown is the evidence the adjudicator was given. That matters
 * because the product's whole argument is that the reasoning is inspectable.
 *
 * Streaming is parsed manually rather than with EventSource because
 * EventSource cannot issue a POST, and the claim does not belong in a URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n/client';
import { countryName } from '@/lib/i18n';
import { getDirectoryCountry } from '@/lib/data/country-directory';
import { countOfficial, isOfficialSource, officialFirst } from '@/lib/verify/sources';
import { consumeVerificationStream, IncompleteVerificationError } from '@/lib/verify/stream';
import { loadPublicRecording } from '@/lib/verify/recording-loader';
import { useVerificationAvailability } from '@/lib/verify/use-availability';
import VerificationAvailability from './VerificationAvailability';
import { CLAIM_MAX_LENGTH, truncateClaim } from '@/lib/verify/claim-text';
import { useResearchLead, clearResearchLead } from '@/lib/intelligence/use-research-lead';
import { bindResearchLead, linkedResearchLead, type BoundResearchLead } from '@/lib/intelligence/research-lead';
import { liveReport, recordedReport, reportFilename, reportMarkdown,
  type RecordedVerification, type VerificationReport, type ReportDoc } from '@/lib/verify/report';
import type {
  AssertionResult,
  EvidenceDoc,
  OverallVerdict,
  ReviewPersistence,
  ScreenedDoc,
  VerifyEvent,
  VerificationResult,
} from '@/lib/verify/types';

/**
 * Claim starters contain only authored claim text. Selecting one fills the form;
 * it does not replay an old verdict or make a provider call. The visitor starts
 * a fresh run explicitly with the Verify button.
 */
const PROMPT_INDEX_URL = '/verify-prompts/index.json';
const BOE_RECORDING_URL = '/verify-recordings/boe-service-passport-adjudication-20261012.json';
const EU_RECORDING_URL = '/verify-recordings/eu-ai-act-entry-20261013.json';
const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1';

interface PromptIndexEntry {
  id: string;
  claim: string;
}

/** The subset of a doc that this page actually renders, from any source. */
type DisplayDoc = ReportDoc;

type StageRow = { key: string; label: string; done: boolean };

const VERDICT_STYLE: Record<string, { dot: string; text: string }> = {
  supported: { dot: 'bg-green-500', text: 'text-green-500' },
  refuted: { dot: 'bg-red-500', text: 'text-red-500' },
  insufficient_evidence: { dot: 'bg-yellow-500', text: 'text-yellow-500' },
};

/** The raw enum values are not readable; "insufficient_evidence" is not English. */
function verdictLabel(verdict: OverallVerdict, t: (en: string, zh: string) => string): string {
  switch (verdict) {
    case 'supported':
      return t('Supported', '已证实');
    case 'refuted':
      return t('Refuted', '已证伪');
    default:
      return t('Not enough evidence', '证据不足');
  }
}

export default function VerifyPage() {
  const t = useT();
  const locale = useLocale();
  // Arriving from a policy update on /news carries the headline in ?claim=.
  // Read during initialisation rather than in an effect: the server and the
  // client both see the same search params, so there is no hydration mismatch
  // and no setState-in-effect. It pre-fills and does NOT auto-run — a
  // verification spends real search and model calls, so the visitor starts it.
  const searchParams = useSearchParams();
  const mapCountry = getDirectoryCountry(searchParams.get('country') ?? '');
  const entryClaim = searchParams.get('claim') ?? '';
  const entrySource = searchParams.get('source');
  const storedLead = useResearchLead(entryClaim);
  const linkedLead = useMemo(() => linkedResearchLead(entryClaim, entrySource), [entryClaim, entrySource]);
  const leadKey = JSON.stringify([entryClaim, entrySource]);
  const [clearedLeadKey, setClearedLeadKey] = useState<string | null>(null);
  const lead = clearedLeadKey === leadKey ? null : entrySource !== null ? linkedLead : storedLead;
  function clearLead() {
    setClearedLeadKey(leadKey);
    clearResearchLead();
  }
  const [claim, setClaim] = useState(
    () => truncateClaim(searchParams.get('claim') ?? ''),
  );
  const [running, setRunning] = useState(false);
  const [inspectSources, setInspectSources] = useState(false);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [evidence, setEvidence] = useState<Record<string, EvidenceDoc[]>>({});
  const [screened, setScreened] = useState<Record<string, ScreenedDoc[]>>({});
  const [verdicts, setVerdicts] = useState<AssertionResult[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [overall, setOverall] = useState<OverallVerdict | null>(null);
  const [prompts, setPrompts] = useState<PromptIndexEntry[]>([]);
  const [recorded, setRecorded] = useState<RecordedVerification | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const { availability, loading: availabilityLoading, refresh: refreshAvailability } = useVerificationAvailability();
  const accessBlocked = availability !== null && availability.status !== 'available';
  const [finishedResult, setFinishedResult] = useState<VerificationResult | null>(null);
  const [reviewPersistence, setReviewPersistence] = useState<ReviewPersistence | null>(null);
  const [finishedLead, setFinishedLead] = useState<BoundResearchLead | null>(null);
  const [previousReport, setPreviousReport] = useState<VerificationReport | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [runTrail, setRunTrail] = useState<{
    tavilyCalls: number;
    modelCalls: number;
    elapsedMs: number;
    tavilyRequestIds: string[];
  } | null>(null);
  const [recordedDocs, setRecordedDocs] = useState<Record<string, DisplayDoc[]>>({});
  const publicPassages = Object.values(recorded?.provenance?.adjudicationEvidence ?? {}).flat().length;
  const withheldPassages = Object.values(recorded?.omittedAdjudicationUrls ?? {}).flat().length;
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const supportedCount = verdicts.filter((v) => v.verdict === 'supported').length;
  const refutedCount = verdicts.filter((v) => v.verdict === 'refuted').length;
  const unresolvedCount = verdicts.length - supportedCount - refutedCount;
  const citedUrls = verdicts.flatMap((v) => v.citedUrls);
  const officialCited = countOfficial(citedUrls);
  const overallStyle = overall ? (VERDICT_STYLE[overall] ?? VERDICT_STYLE.insufficient_evidence) : null;
  // Always export the completed run's claim, never the editable form text.
  const report = finishedResult
    ? liveReport(finishedResult, { ...evidence, ...screened }, undefined, finishedLead, reviewPersistence)
    : recorded ? recordedReport(recorded) : null;

  const exportReport = (format: 'md' | 'json', selected = report) => {
    if (!selected || running) return;
    setExportError(null);
    try {
      const download = { ...selected, exportedAt: new Date().toISOString() };
      const content = format === 'json' ? `${JSON.stringify(download, null, 2)}\n` : reportMarkdown(download);
      const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = reportFilename(download, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(t('Could not download the report. Please try again.', '报告下载失败，请重试。'));
    }
  };

  const reset = useCallback(() => {
    if (report) setPreviousReport(report);
    setStages([]);
    setEvidence({});
    setScreened({});
    setVerdicts([]);
    setErrors([]);
    setOverall(null);
    setRecorded(null);
    setFinishedResult(null);
    setReviewPersistence(null);
    setFinishedLead(null);
    setExportError(null);
    setRunTrail(null);
    setRecordedDocs({});
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    fetch(PROMPT_INDEX_URL)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: PromptIndexEntry[]) => {
        if (!cancelled) setPrompts(list);
      })
      // The form still works if the optional starter list cannot load.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openRecording = async (url: string) => {
    if (running || recordingLoading) return;
    setRecordingLoading(true);
    try {
      const example = await loadPublicRecording(url);
      reset();
      clearLead();
      setClaim(example.claim);
      setVerdicts(example.assertions);
      setRecordedDocs(example.docs);
      setInspectSources(true);
      setOverall(example.overall);
      setRunTrail({
        tavilyCalls: example.stats.tavilyCalls,
        modelCalls: example.stats.modelCalls,
        elapsedMs: example.stats.elapsedMs,
        tavilyRequestIds: example.tavilyRequestIds ?? [],
      });
      setRecorded(example);
      setPreviousReport(null);
    } catch {
      setErrors([t('Could not load the recording. Please try again.', '运行记录无法加载，请重试。')]);
    } finally {
      setRecordingLoading(false);
    }
  };

  const apply = useCallback((ev: VerifyEvent) => {
    switch (ev.type) {
      case 'stage':
        setStages((prev) => {
          const key = `${ev.stage}:${ev.detail ?? ''}`;
          if (ev.status === 'start') return [...prev, { key, label: labelFor(ev.stage, ev.detail), done: false }];
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (!next[i].done) {
              next[i] = { ...next[i], done: true, label: labelFor(ev.stage, ev.detail) };
              break;
            }
          }
          return next;
        });
        break;
      case 'evidence':
        setEvidence((p) => ({ ...p, [ev.assertionId]: ev.docs }));
        break;
      case 'screened':
        setScreened((p) => ({ ...p, [ev.assertionId]: ev.docs }));
        break;
      case 'verdict':
        setVerdicts((p) => [...p, ev.result]);
        break;
      case 'error':
        setErrors((p) => [...p, ev.message]);
        break;
      case 'done':
        setPreviousReport(null);
        setFinishedResult(ev.result);
        setReviewPersistence(ev.reviewPersistence ?? null);
        setOverall(ev.result.overall);
        setRunTrail({
          tavilyCalls: ev.result.stats.tavilyCalls,
          modelCalls: ev.result.stats.modelCalls,
          elapsedMs: ev.result.stats.elapsedMs,
          tavilyRequestIds: ev.result.tavilyRequestIds,
        });
        break;
      default:
        break;
    }
  }, []);

  const run = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value || running || recordingLoading || STATIC_DEMO || accessBlocked) return;
      const runLead = recorded ? null : bindResearchLead(lead, value);
      reset();
      setRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let receivedFinal = false;
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim: value, inspectSources }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setErrors([j.error ?? t('Verification failed to start.', '核验未能启动。')]);
          return;
        }
        await consumeVerificationStream(res.body, (event) => {
          if (event.type === 'done') {
            receivedFinal = true;
            setFinishedLead(runLead);
          }
          apply(event);
        });
      } catch (e) {
        if (!receivedFinal && controller.signal.aborted) {
          setErrors((p) => [...p, t('Verification stopped. Any partial findings below are incomplete; review saving is not confirmed.', '核验已停止。下方部分结果并不完整，复核记录是否保存也尚未确认。')]);
        } else if (!receivedFinal) {
          setErrors((p) => [...p, e instanceof IncompleteVerificationError
            ? t('Verification ended before a complete result was received. Any partial findings below are incomplete; review saving is not confirmed.', '核验结束时未收到完整结果。下方部分结果并不完整，复核记录是否保存也尚未确认。')
            : t('Connection to the server was lost. A complete result and review saving are not confirmed.', '与服务器的连接中断，完整结果和复核记录保存均未确认。')]);
        }
      } finally {
        setStages(prev => prev.map(stage => stage.done ? stage : {
          ...stage, done: true, label: `${stage.label} (${t('interrupted', '已中断')})`,
        }));
        setRunning(false);
        abortRef.current = null;
        void refreshAvailability();
      }
    },
    [apply, running, recordingLoading, t, inspectSources, lead, recorded, reset, accessBlocked, refreshAvailability],
  );

  return (
    <>
      {/* Dark band, matching the home page hero. The site alternates dark and
          light by section; before this, Home opened dark and Verify was a
          plain light page, so moving between them read as two products. The
          results stay on the light surface below, where long rationales and
          lists of source URLs are easier to read. */}
      <section className="relative isolate overflow-hidden bg-[#070A12] text-white">
        <div aria-hidden className="hero-grid pointer-events-none absolute inset-0 opacity-[0.06]" />
        <div
          aria-hidden
          className="hero-globe-glow pointer-events-none absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-16 sm:py-20">
          <h1 className="text-3xl font-bold leading-[1.1] tracking-tight md:text-[2.5rem]">
            {t('Verify a policy claim,', '核验一条政策声明，')}
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-[#5FB0FF] to-[#9BE1FF] bg-clip-text text-transparent">
              {t('against sources, in the open.', '对照来源，过程可见。')}
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/60">
            {t(
              'Every live check retrieves its sources again. Inspect the evidence, follow the reasoning, and take the record with you.',
              '每次实时核验都会重新检索来源。查看证据、追溯判断，并下载核验记录。',
            )}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-10">
      {STATIC_DEMO && <aside role="status" className="mb-5 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
        <p className="font-semibold">{t('Recorded runs · live checks paused', '运行记录 · 实时核验暂停')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t(
          'This free public build does not call Tavily or Nebius. Open a dated run below to inspect saved evidence and its recorded verdict.',
          '这个免费公开版本不会调用 Tavily 或 Nebius。请打开下方带日期的运行记录，查看已保存的证据及当时的判断。',
        )}</p>
      </aside>}
      {mapCountry && <aside data-testid="map-country-context" className="mb-5 rounded-xl border border-border bg-surface-2 p-4 text-sm">
        <p className="font-medium">{t('From the map: ', '来自地图：')}{countryName(mapCountry.iso, mapCountry.name, locale)}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t('Write a precise policy claim that names this country. The map selection is research context only; the live verifier searches fresh sources for the claim you enter and may find insufficient evidence.',
            '请写一条包含该国名称的具体政策声明。地图选择仅供研究参考；实时核验会为你输入的声明重新检索来源，也可能得到“证据不足”。')}
        </p>
      </aside>}
      {lead && !recorded && <aside data-testid="research-lead" className="mb-5 rounded-xl border border-border bg-surface-2 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">{t('Original article · unverified lead', '原报道 · 未核验线索')}</h2>
          <button type="button" disabled={running} onClick={clearLead} className="text-xs text-muted underline underline-offset-2 disabled:opacity-40">{t('Clear lead for next check', '清除下次核验的线索')}</button>
        </div>
        <p className="mt-2 break-words">{lead.claim}</p>
        <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-accent underline underline-offset-2">{lead.sourceUrl}</a>
        <p className="mt-2 text-xs text-muted">{t('This link is research context. It is not passed to the model or counted as evidence; a live check retrieves its own sources.', '该链接仅供研究参考，不传给模型，也不计入证据；实时核验会重新检索来源。')}</p>
      </aside>}
      <VerificationAvailability availability={availability} loading={availabilityLoading} refresh={refreshAvailability} />
      <form
        className="mt-0"
        onSubmit={(e) => {
          e.preventDefault();
          void run(claim);
        }}
      >
        <textarea
          value={claim}
          readOnly={running || recordingLoading}
          aria-label={t('Policy claim', '政策声明')}
          onChange={(e) => setClaim(e.target.value)}
          rows={3}
          maxLength={CLAIM_MAX_LENGTH}
          placeholder={t('e.g. Canada raised its Express Entry CRS cutoff above 500 in 2026.', '例如：加拿大在 2026 年把 Express Entry 的 CRS 分数线提高到 500 以上。')}
          className="w-full rounded-xl border border-border bg-surface p-4 text-foreground outline-none focus:border-accent"
        />
        <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={inspectSources} disabled={running || recordingLoading || STATIC_DEMO}
            onChange={(e) => setInspectSources(e.target.checked)} className="mt-1 accent-accent" />
          <span>{t('Seek official sources and read source pages', '补找官方来源并读取原文')}
            <span className="mt-1 block text-xs text-muted">{t(
              'Uses additional bounded searches and page reads. Unavailable pages keep their search excerpts.',
              '会增加受预算限制的检索与原文读取。页面读取失败时保留搜索摘录。',
            )}</span>
          </span>
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={running || recordingLoading || !claim.trim() || STATIC_DEMO || accessBlocked}
            className="rounded-full bg-accent px-5 py-2 font-medium text-white disabled:opacity-40"
          >
            {STATIC_DEMO ? t('Live checks paused', '实时核验暂停') : running ? t('Verifying…', '核验中…') : t('Verify', '开始核验')}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              {t('Stop', '停止')}
            </button>
          )}
        </div>
      </form>

      {prompts.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs text-muted">
            {STATIC_DEMO
              ? t('Claim starters are examples; live checking is paused on this build.', '下列题目仅作示例；此版本已暂停实时核验。')
              : t('Claim starters — choose one, then Verify to retrieve fresh sources.', '核验题目 —— 选一条，再点「开始核验」检索最新来源。')}
          </p>
          <div className="flex flex-wrap gap-2">
            {prompts.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={running || recordingLoading}
                onClick={() => { reset(); clearLead(); setClaim(entry.claim); }}
                className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 py-2 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {entry.claim.slice(0, 46)}…
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-xl border border-border bg-surface-2 p-4 text-sm">
        <p className="font-medium">{t('Inspect a dated real run', '查看有日期的真实运行记录')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t('These saved examples open without provider calls. The EU AI Act example is the run shown in the walkthrough video. Each recording identifies which model-input passages are public and which are withheld.',
            '这些历史案例无需调用服务商。EU AI Act 案例对应操作视频中的核验。每条记录均注明哪些模型输入摘录已公开、哪些未公开。')}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={running || recordingLoading} onClick={() => void openRecording(EU_RECORDING_URL)}
          className="min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          {t('Open EU AI Act recorded run', '打开 EU AI Act 运行记录')}
        </button>
        <button type="button" disabled={running || recordingLoading} onClick={() => void openRecording(BOE_RECORDING_URL)}
          className="min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          {t('Open BOE recorded run', '打开 BOE 运行记录')}
        </button>
        </div>
        {recordingLoading && <p role="status" className="mt-2 text-xs text-muted">{t('Loading saved record…', '正在加载历史记录…')}</p>}
      </div>

      {recorded?.sourceAttribution && (
        <aside data-testid="recording-scope" className="mt-6 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
          <p className="font-semibold">{t('Historical recording · not a live check', '历史运行记录 · 并非实时核验')}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {t('Recorded on ', '运行于 ')}{recorded.ranAt}.{' '}
            {recorded.publicEvidenceScope === 'selected_adjudication'
              ? t(`Selected evidence only: ${publicPassages} of ${publicPassages + withheldPassages} adjudication passages are public. The other ${withheldPassages} passages and earlier retrieval/screening text are withheld. This is not the complete model input.`,
                `仅公开部分证据：${publicPassages + withheldPassages} 份裁决输入摘录中公开了 ${publicPassages} 份，其余 ${withheldPassages} 份及此前的检索、筛选文本未公开。这并非完整模型输入。`)
              : t('Exact passages submitted to adjudication are included; earlier retrieval and screening text is withheld.',
                '包含提交给裁决模型的原文摘录；此前检索和筛选的文本未公开。')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {recorded.sourceAttribution.label}.{' '}
            {recorded.sourceAttribution.publicationDate && <>{t('Primary document published', '原始文件公布于')} {recorded.sourceAttribution.publicationDate}.{' '}</>}
            {recorded.sourceAttribution.correctionDate && <>{t('Correction published', '更正公布于')} {recorded.sourceAttribution.correctionDate}.{' '}</>}
            {recorded.sourceAttribution.selectionNotice}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <a href={recorded.sourceAttribution.primaryDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">{t('Original source', '原始来源')}</a>
            <a href={recorded.sourceAttribution.reuseNoticeUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">{t('Source reuse notice', '来源转载声明')}</a>
          </div>
          <button type="button" disabled={running || STATIC_DEMO} onClick={() => void run(recorded.claim)}
            className="mt-3 min-h-10 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
            {STATIC_DEMO
              ? t('Live rerun paused on this build', '此版本已暂停实时重跑')
              : t('Run this claim again with live sources', '用实时来源重新核验这条声明')}
          </button>
        </aside>
      )}

      {stages.length > 0 && (
        <section className="mt-8 rounded-xl border border-border bg-surface-2 p-4">
          <h2 className="text-sm font-medium text-muted">{t('What ran', '执行过程')}</h2>
          <ol className="mt-2 space-y-1 font-mono text-xs">
            {stages.map((s) => (
              <li key={s.key} className={s.done ? 'text-muted' : 'text-foreground'}>
                {s.done ? '✓' : '…'} {s.label}
              </li>
            ))}
          </ol>
        </section>
      )}

      {errors.map((msg) => (
        <p key={msg} className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">
          {msg}
        </p>
      ))}

      {!running && !report && previousReport && (
        <aside role="status" data-testid="previous-report" className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm">
          <p className="font-medium">{t('Previous completed report available', '上一份完整报告仍可下载')}</p>
          <p className="mt-2 break-words">{t('Previous checked claim: ', '上次核验的声明：')}{previousReport.claim}</p>
          <p className="mt-1 text-xs text-muted">{t('This is the previous result, not a result for the current attempt. Download it before leaving this page.', '这是上一次的结果，不代表当前尝试。离开此页面前请下载留存。')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => exportReport('md', previousReport)} className="min-h-11 rounded-lg border border-border px-3 py-2">{t('Download previous report', '下载上一份报告')}</button>
            <button type="button" onClick={() => exportReport('json', previousReport)} className="min-h-11 rounded-lg border border-border px-3 py-2">{t('Download previous data (JSON)', '下载上次数据（JSON）')}</button>
          </div>
          {exportError && <p role="alert" className="mt-2 text-red-500">{exportError}</p>}
        </aside>
      )}

      {overall && overallStyle && (
        <section className="mt-8 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${overallStyle.dot}`} />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted">{t('Overall', '总体结论')}</p>
              <p className={`text-lg font-semibold ${overallStyle.text}`}>{verdictLabel(overall, t)}</p>
              <p className="mt-1 text-sm text-muted">
                {t(
                  `${supportedCount} of ${verdicts.length} checks confirmed by sources, ${refutedCount} contradicted, ${unresolvedCount} unresolved.`,
                  `${verdicts.length} 条断言中，${supportedCount} 条被来源证实、${refutedCount} 条被推翻、${unresolvedCount} 条无法判定。`,
                )}
              </p>
              {finishedResult?.provenance?.decompositionFallback === 'whole_claim' && (
                <p role="status" data-testid="whole-claim-fallback" className="mt-2 text-sm text-muted">
                  {t(
                    'Both decomposition model calls failed. We checked the original claim as one assertion; its parts were not verified separately.',
                    '两次模型拆解调用均失败。本次将原声明作为一条断言核验；其中各部分没有分别核验。',
                  )}
                </p>
              )}
              {citedUrls.length > 0 && (
                <p className="mt-1 text-sm text-muted">
                  {officialCited === 0
                    ? t(
                        `None of the ${citedUrls.length} cited URLs matches our recognized government or multilateral domains. The issuing body has not been established by this domain check.`,
                        `被引用的 ${citedUrls.length} 条网址没有一条匹配已识别的政府或多边机构域名。域名检查未确认政策发布机关。`,
                      )
                    : t(
                        `${officialCited} of ${citedUrls.length} cited URLs match recognized government or multilateral domains. This does not establish the issuing body or prove the claim.`,
                        `被引用的 ${citedUrls.length} 条网址中，${officialCited} 条匹配已识别的政府或多边机构域名；这不能确认发布机关或证明声明。`,
                      )}
                </p>
              )}
              {overall === 'insufficient_evidence' && supportedCount > 0 && (
                <p className="mt-1 text-sm text-muted">
                  {t(
                    'Some parts of the claim are backed by sources, but the part that distinguishes it is not — which is why this is not "true".',
                    '这条说法的一部分有来源支持，但真正能把它和别的说法区分开的那部分没有——所以它不算「为真」。',
                  )}
                </p>
              )}
            </div>
          </div>

          {runTrail && (
            <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
              <p>
                {t(
                  `Retrieval: Tavily APIs, ${runTrail.tavilyCalls} call(s). Reasoning: ${runTrail.modelCalls} call(s) to NVIDIA Nemotron 3 on Nebius Token Factory. ${Math.round(runTrail.elapsedMs / 1000)}s.`,
                  `检索：Tavily API，${runTrail.tavilyCalls} 次调用。推理：${runTrail.modelCalls} 次调用 NVIDIA Nemotron 3（Nebius Token Factory）。耗时 ${Math.round(runTrail.elapsedMs / 1000)} 秒。`,
                )}
              </p>
              {runTrail.tavilyRequestIds.length > 0 && (
                <p className="mt-1 break-all font-mono text-[11px] opacity-70">
                  {t('Tavily request ids: ', 'Tavily 请求 id：')}
                  {runTrail.tavilyRequestIds.join(', ')}
                </p>
              )}
            </div>
          )}

          {finishedResult && (
            <p role="status" data-testid="review-persistence-status" className="mt-3 text-xs text-muted">
              {reviewPersistence?.status === 'saved'
                ? t(`Saved ${reviewPersistence.savedAssertions} assertion(s) for human review.`, `已将 ${reviewPersistence.savedAssertions} 条断言保存供人工审核。`)
                : reviewPersistence?.status === 'skipped'
                  ? t('This run was not saved to the review queue; download the report to keep a copy.', '本次未保存到审核队列；请下载报告留存。')
                  : reviewPersistence?.status === 'failed'
                    ? t('Review queue saving failed or may be incomplete; download the report to keep a copy.', '审核队列保存失败或可能不完整；请下载报告留存。')
                    : t('Review queue save status was not recorded; download the report to keep a copy.', '未记录审核队列保存状态；请下载报告留存。')}
            </p>
          )}

          {report && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="break-words text-sm font-medium">
                {t('Checked claim: ', '已核验的声明：')}{report.claim}
              </p>
              <p className="mt-1 text-xs text-muted">
                {report.ranAt ? t('Run time: ', '运行时间：') + report.ranAt : t('Run time was not recorded by this version.', '此版本未记录运行时间。')}
              </p>
              <dl data-testid="recorded-models" className="mt-3 grid gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs sm:grid-cols-3">
                {([
                  [t('Decomposition model', '声明拆解模型'), report.models.decomposer],
                  [t('Screening model', '来源筛选模型'), report.models.screener],
                  [t('Adjudication model', '证据裁决模型'), report.models.adjudicator],
                ] as const).map(([label, model]) => <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="mt-1 break-all font-mono">{model ?? t('Not recorded', '未记录')}</dd>
                </div>)}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={running} onClick={() => exportReport('md')}
                  className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
                  {t('Download report', '下载核验报告')}
                </button>
                <button type="button" disabled={running} onClick={() => exportReport('json')}
                  className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
                  {t('Download data (JSON)', '下载数据（JSON）')}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                {t('Includes the claim, verdicts, evidence excerpts, source URLs and recorded tool usage.', '包含原声明、结论、证据摘录、来源链接与工具运行记录。')}
              </p>
              {exportError && <p role="alert" className="mt-2 text-sm text-red-500">{exportError}</p>}
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted">
            {t(
              'This verdict is model output and cannot change country scores automatically. When saved for human review, it is marked as AI-inferred and stored at low confidence.',
              '这是模型输出，无法自动改变国家分数。保存供人工审核时，结果会标为 AI 推断，并以低置信度存储。',
            )}
          </p>
        </section>
      )}

      {verdicts.map((v) => {
        const style = VERDICT_STYLE[v.verdict] ?? VERDICT_STYLE.insufficient_evidence;
        const docs: DisplayDoc[] =
          screened[v.assertion.id] ?? evidence[v.assertion.id] ?? recordedDocs[v.assertion.id] ?? [];
        return (
          <article key={v.assertion.id} className="mt-6 rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
              <div className="min-w-0">
                <p className="font-medium">{v.assertion.text}</p>
                <p className={`mt-1 text-sm font-medium ${style.text}`}>
                  {v.verdict.replace(/_/g, ' ')}
                  <span className="ml-2 font-normal text-muted">
                    {/* The number means different things per verdict, so the
                        label has to say which. "insufficient_evidence at 0.9"
                        is unreadable without it. */}
                    {v.verdict === 'insufficient_evidence'
                      ? t('model is this sure the evidence settles nothing', '模型对「证据确实定不了论」的确信度')
                      : t('model self-reported confidence in this verdict', '模型对该结论的自述置信度')}{' '}
                    {v.confidence}
                  </span>
                </p>
              </div>
            </div>

            <p className="mt-3 text-sm text-muted">{v.rationale}</p>

            {v.citedUrls.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {/* Show recognized official domains first; domain recognition
                    alone does not identify the issuing body. */}
                {officialFirst(v.citedUrls).map((u) => (
                  <li key={u} className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                    {isOfficialSource(u) && (
                      <span className="shrink-0 rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-400">
                        {t('Recognized official domain', '已识别官方域名')}
                      </span>
                    )}
                    <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">
                      {u}
                    </a>
                    </div>
                    {(() => {
                      const exact = report?.adjudicationEvidence?.[v.assertion.id]?.find((d) => d.url === u);
                      const retrieved = docs.find((d) => d.url === u);
                      const excerpt = exact?.snippet ?? retrieved?.snippet;
                      const origin = exact?.snippet !== undefined ? exact : retrieved;
                      const discovery = origin?.issuerDiscovery;
                      return excerpt ? (
                        <div className="mt-2 border-l-2 border-border pl-3">
                          <p className="text-xs text-muted">{exact
                            ? t('Excerpt submitted for this verdict', '本次裁决接收的摘录')
                            : t('Retrieved source excerpt', '检索到的来源摘录')}</p>
                          {origin?.extractionRequestId !== undefined && (
                            <p className="mt-1 break-all text-xs text-muted">{t('Read from source page · Tavily Extract', '已读取来源原文 · Tavily Extract')}
                              {' · '}{origin.extractionRequestId || t('Request ID not returned', '未返回请求编号')}</p>
                          )}
                          {origin?.issuerHtmlRead === true && (
                            <p className="mt-1 text-xs text-muted">{discovery
                              ? t('Read directly from the document linked in the official index', '直接读取官方目录链接的文件')
                              : t('Read directly from the source URL found by Tavily', '直接读取 Tavily 找到的来源网址')}</p>
                          )}
                          {discovery && (
                            <details className="mt-2 text-xs text-muted">
                              <summary className="cursor-pointer">{t('How we found this source', '如何找到这份来源')}</summary>
                              <ol className="mt-2 list-decimal space-y-2 pl-5">
                                <li>{t('Tavily found a related section: ', 'Tavily 找到相关章节：')}
                                  <a href={discovery.seedUrl} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">{discovery.seedUrl}</a>
                                </li>
                                <li>{t('The official index linked to this document: ', '官方目录指向本文件：')}
                                  <a href={discovery.indexUrl} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">{discovery.indexUrl}</a>
                                </li>
                                <li>{t('We read that document directly. Its retained passage appears below.', '直接读取该文件，保留的摘录见下方。')}</li>
                              </ol>
                              <p className="mt-2 break-all">{t('Tavily seed request: ', 'Tavily 线索请求：')}{discovery.seedRequestId || t('Not recorded', '未记录')}</p>
                            </details>
                          )}
                          <blockquote className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{excerpt}</blockquote>
                          <p className="mt-1 text-xs text-muted">{t('Truncated source excerpt; open the source for its full context.', '这是截取的来源内容，完整上下文请查看原文。')}</p>
                        </div>
                      ) : <p className="mt-1 text-xs text-muted">{t('No saved excerpt is available.', '没有可用的已保存摘录。')}</p>;
                    })()}
                  </li>
                ))}
              </ul>
            )}

            {docs.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-muted">
                  {recorded?.publicEvidenceScope === 'selected_adjudication'
                    ? t('Public evidence selection', '公开的部分证据')
                    : t('Evidence considered', '参与判断的证据')} ({docs.length})
                </summary>
                <ul className="mt-2 space-y-2 text-xs">
                  {docs.map((d) => {
                    const kept = 'relevant' in d ? d.relevant : true;
                    const leaning = 'leaning' in d ? d.leaning : '';
                    return (
                      <li key={d.url} className="min-w-0 rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                        <span className={kept ? 'text-foreground' : 'text-muted line-through'}>
                          {d.issuerDiscovery
                            ? t('Official-index discovery · not search-scored', '官方目录发现 · 无搜索评分')
                            : d.retrievalScore.toFixed(2)}
                        </span>
                        <span className="text-muted">{leaning}</span>
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="break-words underline">
                          {d.title}
                        </a>
                        </div>
                        <p className="mt-1 text-muted">{kept ? t('Kept for adjudication', '保留供裁决') : t('Discarded during screening', '筛选时排除')}{d.reason ? ` · ${d.reason}` : ''}</p>
                        {d.snippet && <blockquote className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{d.snippet}</blockquote>}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </article>
        );
      })}

      </div>
    </>
  );
}

/**
 * The stage log is the page's main claim to being inspectable, so it names the
 * service doing the work rather than an internal verb. "retrieve" told a reader
 * nothing about where the documents came from.
 */
const STAGE_LABEL: Record<string, string> = {
  decompose: 'decompose · Nemotron 3 Super',
  retrieve: 'retrieve · Tavily Search',
  extract: 'read source pages · Tavily Extract',
  screen: 'screen · Nemotron 3 Super',
  adjudicate: 'adjudicate · Nemotron 3 Ultra',
};

function labelFor(stage: string, detail?: string): string {
  if (stage === 'decompose' && detail?.startsWith('model transport failed twice')) {
    return `decomposition unavailable · original claim retained — ${detail}`;
  }
  const label = STAGE_LABEL[stage] ?? stage;
  return detail ? `${label} — ${detail}` : label;
}
