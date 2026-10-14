import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectMonitorSource } from '../monitor-source';
import { parseMonitorQuery, type MonitorResult } from '../query';

const query = parseMonitorQuery(new URLSearchParams('country=NZ&q=carbon&limit=1'));
const result = (mode: 'database' | 'direct'): MonitorResult => ({
  items: [], nextCursor: null, available: true, checkedAt: '2026-10-14T00:00:00Z', mode,
});

test('an empty contest archive reads existing official connectors using the unchanged filter', async () => {
  const direct = result('direct');
  assert.equal(await selectMonitorSource(query, { hasArchive: async () => false,
    archive: async () => { throw Error('Must not read an empty archive'); },
    official: async received => { assert.equal(received, query); return direct; },
  }), direct);
});

test('a populated archive with zero matches never switches sources or cursor spaces', async () => {
  const page = result('database');
  const paginated = { ...query, cursor: { publishedAt: '2026-10-12T00:00:00.000Z', id: 'stored-id' } };
  assert.equal(await selectMonitorSource(paginated, { hasArchive: async () => true,
    archive: async received => { assert.equal(received, paginated); return page; },
    official: async () => { throw Error('Must not mix pagination sources'); },
  }), page);
});

test('an archive lookup failure remains visible rather than being disguised as no announcements', async () => {
  await assert.rejects(selectMonitorSource(query, { hasArchive: async () => { throw Error('DB unavailable'); },
    archive: async () => result('database'), official: async () => result('direct'),
  }), /DB unavailable/);
});
