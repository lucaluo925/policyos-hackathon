import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { adminCookieValue, isAdminRequest, isValidAdminCookie, passwordMatches, ADMIN_COOKIE } from '../admin';

const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  delete env.ADMIN_PASSWORD;
  env.NODE_ENV = 'test';
});

test('production without ADMIN_PASSWORD disables admin entirely', async () => {
  env.NODE_ENV = 'production';
  assert.equal(passwordMatches('dev-only-change-me'), false);
  assert.equal(await adminCookieValue(), null);
  assert.equal(await isValidAdminCookie('ok'), false);
});

test('legacy fixed cookie value "ok" is rejected', async () => {
  env.ADMIN_PASSWORD = 's3cret-pass';
  assert.equal(await isValidAdminCookie('ok'), false);
});

test('cookie is an HMAC of the password and changes when the password rotates', async () => {
  env.ADMIN_PASSWORD = 's3cret-pass';
  const v1 = await adminCookieValue();
  assert.match(v1!, /^[0-9a-f]{64}$/);
  assert.equal(await isValidAdminCookie(v1), true);
  env.ADMIN_PASSWORD = 'rotated-pass';
  assert.equal(await isValidAdminCookie(v1), false);
});

test('isAdminRequest reads the cookie header', async () => {
  env.ADMIN_PASSWORD = 's3cret-pass';
  const v = await adminCookieValue();
  const ok = new Request('https://x.test/api', { headers: { cookie: `a=1; ${ADMIN_COOKIE}=${v}; b=2` } });
  const bad = new Request('https://x.test/api', { headers: { cookie: `${ADMIN_COOKIE}=ok` } });
  assert.equal(await isAdminRequest(ok), true);
  assert.equal(await isAdminRequest(bad), false);
  assert.equal(await isAdminRequest(new Request('https://x.test/api')), false);
});

test('passwordMatches uses the configured password', () => {
  env.ADMIN_PASSWORD = 's3cret-pass';
  assert.equal(passwordMatches('s3cret-pass'), true);
  assert.equal(passwordMatches('s3cret-pasS'), false);
  assert.equal(passwordMatches(undefined), false);
});

import { isCronOrAdmin } from '../admin';

test('isCronOrAdmin: open without CRON_SECRET; otherwise bearer or admin cookie', async () => {
  delete env.CRON_SECRET;
  assert.equal(await isCronOrAdmin(new Request('https://x.test/')), true);
  env.CRON_SECRET = 'cron-123';
  env.ADMIN_PASSWORD = 's3cret-pass';
  assert.equal(await isCronOrAdmin(new Request('https://x.test/')), false);
  assert.equal(await isCronOrAdmin(new Request('https://x.test/', { headers: { authorization: 'Bearer cron-123' } })), true);
  const v = await adminCookieValue();
  assert.equal(await isCronOrAdmin(new Request('https://x.test/', { headers: { cookie: `${ADMIN_COOKIE}=${v}` } })), true);
  delete env.CRON_SECRET;
});
