import { NextResponse } from 'next/server';

/** Sensitive API responses must never be reused across users or stored by caches. */
export function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Vary', 'Cookie');
  return NextResponse.json(body, { ...init, headers });
}
