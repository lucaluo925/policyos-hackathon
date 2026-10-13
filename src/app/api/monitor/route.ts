import { NextRequest, NextResponse } from 'next/server';
import { parseMonitorQuery, InvalidMonitorQuery } from '@/lib/news/query';
import { queryMonitor } from '@/lib/news/monitor';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const query = parseMonitorQuery(request.nextUrl.searchParams);
    const result = await queryMonitor(query);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof InvalidMonitorQuery) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Official updates are temporarily unavailable' }, { status: 503 });
  }
}
