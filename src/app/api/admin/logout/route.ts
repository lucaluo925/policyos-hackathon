/**
 * POST /api/admin/logout — clear the admin_auth cookie and redirect caller
 * back to the login page.
 */

import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Expire immediately.
  res.cookies.set({
    name: ADMIN_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}
