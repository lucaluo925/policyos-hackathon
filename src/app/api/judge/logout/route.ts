import { NextResponse } from 'next/server';
import { JUDGE_COOKIE, JUDGE_HEADERS, sameOrigin } from '@/lib/auth/judge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!sameOrigin(request, true)) return NextResponse.json({ error: 'Open the judge entrance on this website.' }, { status: 403, headers: JUDGE_HEADERS });
  const res = NextResponse.json({ ok: true }, { headers: JUDGE_HEADERS });
  res.cookies.set({ name: JUDGE_COOKIE, value: '', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return res;
}
