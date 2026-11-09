import { NextResponse } from 'next/server';
import { clampStep, getTemperaturePayload } from './payload';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Global Temperature field.
 *
 * Combines ocean sea-surface temperature + land 2 m air temperature from
 * Open-Meteo (free, no API key) into a single cached GeoJSON grid, plus NASA
 * GIBS colorized raster tile templates for the broad backdrop. The grid is
 * cached to a local file first, then served. The build and cache logic lives
 * in ./payload.ts because Next route files may not export extra symbols.
 */

export async function GET(req: Request) {
  const step = clampStep(new URL(req.url).searchParams.get('step'));
  try {
    const payload = await getTemperaturePayload(step);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('[OSIRIS] temperature route error:', error);
    return NextResponse.json(
      { type: 'FeatureCollection', features: [], error: 'Temperature data unavailable' },
      { status: 500 },
    );
  }
}
