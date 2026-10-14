import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJudgeSession, judgeAccessFailure, judgeCookie, judgeSessionStatus, JUDGE_COOKIE, sameOrigin, validJudgeSession } from '../judge';
import { isAdminRequest } from '../admin';
import { POST as login } from '@/app/api/judge/login/route';
import { POST as logout } from '@/app/api/judge/logout/route';
import { GET as sessionGet } from '@/app/api/judge/session/route';
import { POST as verify } from '@/app/api/verify/route';
import { POST as research } from '@/app/api/explore/research/route';
import { GET as availability } from '@/app/api/verify/availability/route';
const secret = 'isolated-test-credential-32-characters-only';
const now = Date.parse('2026-10-14T18:00:00Z');
const deadline = Date.parse('2026-12-15T20:00:00Z');
function request(path: string, cookie?: string, origin = 'http://localhost') {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { origin, ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: secret, claim: 'Offline test', country: 'NZ', domain: 'trade' }) });
}
function settings() {
  const values = { VERIFY_JUDGE_ACCESS_ENABLED: '1', VERIFY_JUDGE_ACCESS_SECRET: secret, VERIFY_MODEL_BUDGET_EXPIRES_AT: new Date(deadline).toISOString(), ADMIN_PASSWORD: 'separate-admin-only', NEBIUS_API_KEY: 'fake-only', TAVILY_API_KEY: 'fake-only' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}
test('judge sessions expire, are signed, are separate from admin, and revoke on rotation', async t => {
  const restore = settings();
  try {
    const session = createJudgeSession(secret, now)!;
    assert.ok(session);
    assert.equal(session.expiresAt, now + 8 * 3600000);
    assert.ok(validJudgeSession(session.value, now));
    assert.equal(createJudgeSession('incorrect', now), null);
    assert.equal(validJudgeSession(session.value, now - 1), false);
    assert.equal(validJudgeSession(session.value, session.expiresAt), false);
    assert.equal(validJudgeSession(session.value.slice(0, -1) + 'z', now), false);
    assert.equal(validJudgeSession('%broken', now), false);
    const cookie = `${JUDGE_COOKIE}=${session.value}`;
    assert.equal(await isAdminRequest(request('/api/admin/review', cookie)), false);
    assert.equal(await isAdminRequest(request('/api/admin/review', `admin_auth=${session.value}`)), false, 'renaming the judge cookie cannot grant admin access');
    assert.equal(judgeCookie(request('/api/verify', `${cookie}; ${cookie}`)), null);
    assert.equal(judgeCookie(request('/api/verify', `${JUDGE_COOKIE}=%xx`)), null);
    process.env.VERIFY_JUDGE_ACCESS_SECRET = secret + 'rotated';
    assert.equal(validJudgeSession(session.value, now), false);
    process.env.VERIFY_JUDGE_ACCESS_SECRET = secret;
    const nearEnd = createJudgeSession(secret, deadline - 1000)!;
    assert.equal(nearEnd.expiresAt, deadline);
    assert.equal(validJudgeSession(nearEnd.value, deadline), false);
    assert.equal(createJudgeSession(secret, deadline), null);
    process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT = new Date(deadline + 86400000).toISOString();
    assert.equal(createJudgeSession(secret, deadline - 1000)!.expiresAt, deadline);
    process.env.VERIFY_JUDGE_ACCESS_SECRET = process.env.ADMIN_PASSWORD;
    assert.equal(createJudgeSession(process.env.ADMIN_PASSWORD, now), null, 'admin credential cannot become a judge credential');
    t.diagnostic('No providers or database used');
  } finally { restore(); }
});
test('disabled and misconfigured isolation cannot issue credentials; default public gate remains open', async () => {
  const restore = settings();
  try {
    process.env.VERIFY_JUDGE_ACCESS_ENABLED = '0';
    assert.equal(createJudgeSession(secret, now), null);
    assert.deepEqual(judgeSessionStatus(null, now), { enabled: false, ready: false, authenticated: false });
    assert.equal(judgeAccessFailure(request('/api/verify'), now), null);
    assert.equal((await login(request('/api/judge/login'))).status, 503);
    delete process.env.VERIFY_JUDGE_ACCESS_ENABLED;
    assert.equal(judgeAccessFailure(request('/api/verify'), now), null);
    process.env.VERIFY_JUDGE_ACCESS_ENABLED = 'invalid';
    assert.equal(judgeAccessFailure(request('/api/verify'), now)?.status, 503, 'a mistyped activation flag fails closed');
    process.env.VERIFY_JUDGE_ACCESS_ENABLED = '1';
    for (const bad of ['', 'short']) {
      process.env.VERIFY_JUDGE_ACCESS_SECRET = bad;
      assert.equal(judgeAccessFailure(request('/api/verify'), now)?.status, 503);
    }
    process.env.VERIFY_JUDGE_ACCESS_SECRET = secret;
    process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT = 'invalid';
    assert.equal(judgeAccessFailure(request('/api/verify'), now)?.status, 503);
  } finally { restore(); }
});
test('login/logout use bounded HttpOnly cookies and reject cross-site or missing-origin login', async () => {
  const restore = settings();
  try {
    assert.equal((await login(request('/api/judge/login', undefined, 'https://other.example'))).status, 403);
    assert.equal((await login(new Request('http://localhost/api/judge/login', { method: 'POST', body: JSON.stringify({ code: secret }) }))).status, 403);
    const wrong = request('/api/judge/login');
    const bad = new Request(wrong.url, { method: 'POST', headers: wrong.headers, body: JSON.stringify({ code: 'wrong' }) });
    assert.equal((await login(bad)).status, 401);
    const result = await login(request('/api/judge/login'));
    assert.equal(result.status, 200);
    const header = result.headers.get('set-cookie')!;
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=strict/i); assert.match(header, /Expires=/i);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    const cookie = header.split(';')[0];
    const status = await sessionGet(new Request('http://localhost/api/judge/session', { headers: { cookie } }));
    assert.deepEqual(await status.json(), { enabled: true, ready: true, authenticated: true });
    assert.equal(judgeAccessFailure(request('/api/verify', cookie)), null);
    assert.equal(judgeAccessFailure(request('/api/explore/research', cookie, 'https://other.example'))?.status, 403);
    const out = await logout(request('/api/judge/logout', cookie));
    assert.match(out.headers.get('set-cookie')!, /Max-Age=0/i);
    assert.equal((await logout(request('/api/judge/logout', cookie, 'https://other.example'))).status, 403);
    assert.equal(judgeAccessFailure(request('/api/verify'))?.status, 401, 'no cookie after sign-out cannot use paid route');
  } finally { restore(); }
});
test('direct anonymous/forged requests to both paid APIs stop before quota and transport; availability points to login', async () => {
  const restore = settings();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Provider transport prohibited'); };
  try {
    for (const cookie of [undefined, `${JUDGE_COOKIE}=forged`, 'admin_auth=not-a-judge-session']) {
      for (const [path, post] of [['/api/verify', verify], ['/api/explore/research', research]] as const) {
        const result = await post(request(path, cookie));
        assert.equal(result.status, 401);
        assert.equal((await result.json()).code, 'judge_required');
      }
    }
    const status = await availability(new Request('http://localhost/api/verify/availability'));
    assert.equal((await status.json()).status, 'judge_required');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('same-origin checks retain the browser host across NextURL loopback normalization', () => {
  const request = new Request('http://localhost:4103/api/judge/login', {
    method: 'POST', headers: { host: '127.0.0.1:4103', origin: 'http://127.0.0.1:4103', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(sameOrigin(request, true), true);
  const hostile = new Request(request.url, { method: 'POST', headers: { host: '127.0.0.1:4103', origin: 'https://other.example', 'x-forwarded-host': 'other.example' } });
  assert.equal(sameOrigin(hostile, true), false, 'forwarded-host cannot override the destination');
});
