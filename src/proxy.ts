/**
 * Next.js proxy — gates /admin with the admin_auth cookie.
 *
 * Named `proxy` because the `middleware` file convention is deprecated as
 * of Next 16; see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md. Behaviour is unchanged by the rename.
 *
 * Hardened to reject every request for /admin or /admin/* (except the
 * login form itself) unless the `admin_auth` cookie carries the HMAC
 * derived from ADMIN_PASSWORD (see src/lib/auth/admin.ts). Also stamps `Cache-Control: no-store` on every admin
 * response so no CDN, no browser cache, and no bfcache retains the
 * authenticated HTML.
 *
 * Matcher is explicit: both the base path `/admin` and sub-paths
 * `/admin/:path*`. Relying on Next's `:path*` to also match the base path
 * has been inconsistent across Next versions — the explicit list removes
 * any ambiguity.
 */

import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { ADMIN_COOKIE, isValidAdminCookie } from '@/lib/auth/admin';

/*
 * Optional, self-hosted Umami page-view analytics for the OSIRIS module.
 * Merged here from the upstream `src/middleware.ts` of carbon-evolution/osiris
 * (MIT): Next 16 allows only one proxy/middleware file, and this repository's
 * is this one. OFF by default — nothing is sent anywhere unless the operator
 * sets BOTH UMAMI_URL and UMAMI_WEBSITE_ID. Scoped to the /osiris routes by
 * the matcher below, so PolicyOS page loads are not reported.
 */
const ANALYTICS_TIMEOUT_MS = 2000;

function umamiEndpoint(): { endpoint: string; websiteId: string } | null {
  const base = process.env.UMAMI_URL?.trim();
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim();
  if (!base || !websiteId) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/send`;
    return { endpoint: url.toString(), websiteId };
  } catch {
    return null;
  }
}

function reportPageView(request: NextRequest, event: NextFetchEvent): void {
  const umami = umamiEndpoint();
  if (!umami) return;

  // The client IP is forwarded only as a header so Umami can do its own geo
  // lookup / visitor hashing; it is never put in the event payload.
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': request.headers.get('user-agent') || 'Unknown OSIRIS Client',
  };
  if (ip) headers['x-forwarded-for'] = ip;

  const payload = {
    hostname: request.nextUrl.hostname,
    language: 'en-US',
    referrer: request.headers.get('referer') || '',
    screen: '1920x1080',
    title: 'OSIRIS',
    url: request.nextUrl.pathname,
    website: umami.websiteId,
  };

  try {
    const pageView = fetch(umami.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload, type: 'event' }),
      signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
    }).then(
      () => undefined,
      () => undefined,
    );
    event.waitUntil(pageView);
  } catch {
    // Analytics must never break page loads.
  }
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set(
    'Cache-Control',
    'private, no-store, no-cache, must-revalidate, max-age=0',
  );
  res.headers.set('Pragma', 'no-cache');
  // Prevent back-forward cache on Safari/Chrome for admin pages.
  res.headers.set('Vary', 'Cookie');
  return res;
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // OSIRIS routes: optional page-view analytics only, no gating.
  if (pathname === '/osiris' || pathname.startsWith('/osiris/')) {
    reportPageView(request, event);
    return NextResponse.next();
  }

  // /admin/login (and any future sub-path under login) is always allowed.
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  // Gate /admin and every sub-path, regardless of method.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
    if (!(await isValidAdminCookie(cookie))) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/admin/login';
      loginUrl.search = `?next=${encodeURIComponent(pathname + (request.nextUrl.search || ''))}`;
      // 303 See Other on POST, 307 on GET — but redirect() defaults to 307
      // which is fine for GET. no-store so the redirect isn't cached.
      return noStore(NextResponse.redirect(loginUrl));
    }
    // Authorised request: let it through but still mark no-store so the
    // authenticated HTML is never cached anywhere.
    return noStore(NextResponse.next());
  }

  return NextResponse.next();
}

export const config = {
  // Cover the base path *and* all sub-paths. Two entries make the intent
  // explicit and immune to Next's matcher quirks. The /osiris entries exist
  // only so the optional Umami page-view report above can run; no other
  // behaviour applies to them.
  matcher: ['/admin', '/admin/:path*', '/osiris', '/osiris/:path*'],
};
