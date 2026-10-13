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

import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, isValidAdminCookie } from '@/lib/auth/admin';

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  // explicit and immune to Next's matcher quirks.
  matcher: ['/admin', '/admin/:path*'],
};
