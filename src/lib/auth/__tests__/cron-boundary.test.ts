import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { adminCookieValue, ADMIN_COOKIE, isCronOrAdmin } from '../admin';
import { GET as feed } from '../../../app/api/feeds/ingest/route';
import { GET as events } from '../../../app/api/events/ingest/route';
import { GET as check } from '../../../app/api/freshness/check/route';
import { GET as scores } from '../../../app/api/freshness/scores/route';
import { GET as stale } from '../../../app/api/freshness/stale/route';
import { GET as canada } from '../../../app/api/pipeline/canada-immigration/route';
import { GET as pipeline } from '../../../app/api/pipeline/[key]/route';
import { GET as resolve } from '../../../app/api/review/auto-resolve/route';

const env = process.env as Record<string, string | undefined>;
const previous = Object.fromEntries(['NODE_ENV','CRON_SECRET','ADMIN_PASSWORD','DATABASE_URL'].map(k => [k,env[k]]));
const oldFetch = globalThis.fetch;
let network = 0;
beforeEach(() => {
  env.NODE_ENV = 'production'; env.ADMIN_PASSWORD = 'offline-password';
  delete env.CRON_SECRET; delete env.DATABASE_URL; network = 0;
  globalThis.fetch = async () => { network++; throw new Error('OFFLINE: network forbidden'); };
});
after(() => {
  for (const [k,v] of Object.entries(previous)) { if(v===undefined) delete env[k]; else env[k]=v; }
  globalThis.fetch = oldFetch;
});
const routes = [
  ['feeds',feed],['events',events],['freshness/check',check],['freshness/scores',scores],['freshness/stale',stale],
  ['pipeline/canada',canada],['review/auto-resolve',resolve],
  ['pipeline/key',(r: Request) => pipeline(r,{params:Promise.resolve({key:'canada-immigration'})})],
] as const;
for (const [path,handler] of routes) {
  test(`${path}: production missing cron secret denies before DB/network`, async () => {
    const response = await handler(new Request(`http://localhost/api/${path}`));
    assert.equal(response.status,401); assert.equal(network,0);
  });
  test(`${path}: incorrect cron bearer denied`, async () => {
    env.CRON_SECRET='offline-cron';
    const response = await handler(new Request(`http://localhost/api/${path}`,{headers:{authorization:'Bearer incorrect'}}));
    assert.equal(response.status,401); assert.equal(network,0);
  });
  test(`${path}: correct cron bearer reaches only offline DB availability check`, async () => {
    env.CRON_SECRET='offline-cron';
    const response = await handler(new Request(`http://localhost/api/${path}`,{headers:{authorization:'Bearer offline-cron'}}));
    assert.equal(response.status,503); assert.equal(network,0);
  });
  test(`${path}: existing local dev fallback preserved`, async () => {
    env.NODE_ENV='test';
    const response=await handler(new Request(`http://localhost/api/${path}`));
    assert.equal(response.status,503); assert.equal(network,0);
  });
}
test('shared trigger gate preserves admin access with missing or configured cron secret',async () => {
  const headers={cookie:`${ADMIN_COOKIE}=${await adminCookieValue()}`};
  assert.equal(await isCronOrAdmin(new Request('http://localhost',{headers})),true);
  assert.equal(await isCronOrAdmin(new Request('http://localhost')),false);
  env.CRON_SECRET='offline-cron';
  assert.equal(await isCronOrAdmin(new Request('http://localhost',{headers})),true);
});
