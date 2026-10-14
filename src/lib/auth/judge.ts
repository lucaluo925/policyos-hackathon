/** Separate, bounded testing sessions. Disabled unless explicitly activated. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const JUDGE_COOKIE = 'policyos_judge';
export const JUDGE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const SESSION_MS = 8 * 60 * 60 * 1000;
const JUDGING_END = Date.parse('2026-12-15T20:00:00Z');
export function judgeAccessEnabled() {
  const mode = process.env.VERIFY_JUDGE_ACCESS_ENABLED;
  return !!mode && mode !== '0';
}
function configuration(now: number) {
  if (process.env.VERIFY_JUDGE_ACCESS_ENABLED !== '1') return null;
  const secret = process.env.VERIFY_JUDGE_ACCESS_SECRET;
  const expires = Date.parse(process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT ?? '');
  // No fallback password or independent access window. Rotation revokes all sessions.
  if (!secret || [process.env.ADMIN_PASSWORD, process.env.NEBIUS_API_KEY, process.env.TAVILY_API_KEY].some(value => value && value === secret) || secret.length < 32 || secret.length > 512 || !Number.isFinite(expires)) return null;
  const deadline = Math.min(expires, JUDGING_END);
  return deadline > now ? { secret, deadline } : null;
}
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(`policyos-judge-v1:${payload}`).digest('hex');
}
export function createJudgeSession(input: unknown, now = Date.now()) {
  const config = configuration(now);
  if (!judgeAccessEnabled() || !config || typeof input !== 'string' || input.length > 512 || !equal(input, config.secret)) return null;
  const expiresAt = Math.min(now + SESSION_MS, config.deadline);
  const payload = `${now}.${expiresAt}.${randomBytes(16).toString('hex')}`;
  return { value: `${payload}.${sign(payload, config.secret)}`, expiresAt };
}
export function validJudgeSession(value: string | undefined | null, now = Date.now()) {
  const config = configuration(now);
  if (!judgeAccessEnabled() || !config || !value || value.length > 200) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false;
  const [issued, expires] = parts.slice(0, 2).map(Number);
  return Number.isSafeInteger(issued) && Number.isSafeInteger(expires) && issued <= now && expires > now && expires > issued && expires - issued <= SESSION_MS && expires <= config.deadline && equal(parts[3], sign(parts.slice(0, 3).join('.'), config.secret));
}
export function judgeCookie(request: Request) {
  const matches = (request.headers.get('cookie') ?? '').split(/;\s*/).filter(c => c.startsWith(`${JUDGE_COOKIE}=`));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0].slice(JUDGE_COOKIE.length + 1)); } catch { return null; }
}
export function sameOrigin(request: Request, required = false) {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!origin) return !required;
  try {
    // NextURL normalizes loopback URLs to localhost. Host retains the browser's
    // authority; do not use a caller-provided forwarded host for this check.
    const url = new URL(request.url);
    const expected = new URL(`${url.protocol}//${request.headers.get('host') ?? url.host}`).origin;
    return origin === expected;
  } catch { return false; }
}
export function judgeSessionStatus(value: string | null | undefined, now = Date.now()) {
  return { enabled: judgeAccessEnabled(), ready: judgeAccessEnabled() && configuration(now) !== null,
    authenticated: validJudgeSession(value, now) };
}
/** Run before body parsing, database access, quota admission or provider transport. */
export function judgeAccessFailure(request: Request, now = Date.now()) {
  if (!judgeAccessEnabled()) return null;
  if (!configuration(now)) return { status: 503, code: 'judge_unavailable', error: 'Judge testing access needs an operator check.' };
  if (request.method !== 'GET' && !sameOrigin(request)) return { status: 403, code: 'judge_origin', error: 'Open this request from the PolicyOS website.' };
  if (!validJudgeSession(judgeCookie(request), now)) return { status: 401, code: 'judge_required', error: 'Sign in at the judge testing entrance before starting a live request.' };
  return null;
}
