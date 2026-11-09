import { promises as fs } from 'node:fs';
import { clampStep } from '../payload';
import { resolveSource } from './sources';
import { CACHE_DIR, cacheFile, parseDomain, readFresh, render, type Proj } from './renderField';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Smooth temperature field (PNG), per domain + source.
 *
 * `?domain=ocean|land` selects the field; `?source=<id>` selects the data
 * provider (see ./sources.ts). The rendering pipeline lives in
 * ./renderField.ts because Next route files may not export extra symbols.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const step = clampStep(url.searchParams.get('step'));
  const domain = parseDomain(url.searchParams.get('domain'));
  const source = resolveSource(domain, url.searchParams.get('source'));
  const proj: Proj = url.searchParams.get('proj') === 'merc' ? 'merc' : 'geo';
  const file = cacheFile(domain, source, step, proj);

  try {
    let png = await readFresh(file);
    if (!png) {
      png = await render(domain, source, step, proj);
      try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(file, png);
      } catch {
        /* best-effort cache */
      }
    }
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('[OSIRIS] temperature field render error:', error);
    return new Response('field unavailable', { status: 500 });
  }
}
