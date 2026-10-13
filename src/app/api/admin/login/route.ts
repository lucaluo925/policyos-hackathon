/**
 * POST /api/admin/login — validate shared password, set admin_auth cookie.
 *
 * Rejects with 401 on mismatch. On success sets an httpOnly session cookie
 * scoped to the site; it expires when the browser closes (no maxAge).
 */

import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminCookieValue, passwordMatches } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: { password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';
  const cookieValue = await adminCookieValue();
  if (!cookieValue) {
    return NextResponse.json({ error: 'Admin is disabled: ADMIN_PASSWORD is not configured.' }, { status: 503 });
  }
  if (!passwordMatches(password)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // No maxAge → session cookie, clears on browser close.
  });
  return res;
}
