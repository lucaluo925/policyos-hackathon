'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n/client';
import { LOCALE_COOKIE } from '@/lib/i18n';

const links: Array<{ href: string; en: string; zh: string }> = [
  { href: '/', en: 'Home', zh: '首页' },
  { href: '/explore', en: 'Map', zh: '地图' },
  { href: '/compare', en: 'Compare', zh: '对比' },
  { href: '/news', en: 'News', zh: '动态' },
  { href: '/monitor', en: 'Monitor', zh: '监测' },
  { href: '/intelligence', en: 'Intelligence', zh: '情报' },
  { href: '/research', en: 'Research', zh: '研究' },
  { href: '/verify', en: 'Verify', zh: '核验' },
  { href: '/contribute', en: 'Contribute', zh: '贡献' },
];

function LanguageToggle() {
  const locale = useLocale();
  const router = useRouter();
  const next = locale === 'zh' ? 'en' : 'zh';
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      className="px-2.5 py-1 rounded-full text-[12px] text-muted hover:text-foreground border border-border transition-colors"
      aria-label={locale === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      {locale === 'zh' ? 'EN' : '中文'}
    </button>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/72 backdrop-blur-xl backdrop-saturate-150">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-12">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center text-background font-semibold text-sm">P</div>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">PolicyOS</span>
          </Link>

          <div className="hidden xl:flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-full text-[13px] transition-colors ${
                  isActive(link.href) ? 'text-foreground font-medium' : 'text-muted hover:text-foreground'
                }`}
              >
                {t(link.en, link.zh)}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle />
            {/* The admin console is internal tooling. It stays reachable at /admin
                for whoever runs the instance, but shipping it in the public nav
                makes the product look like a half-finished back office. */}
            <Link
              href="/explore"
              className="hidden sm:inline-flex px-3.5 py-1.5 rounded-full text-[13px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              {t('Explore Policies', '浏览政策')}
            </Link>
            <button
              type="button"
              className="xl:hidden w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-foreground hover:bg-surface-2"
              aria-label={open ? t('Close menu', '关闭菜单') : t('Open menu', '打开菜单')}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {open ? (
                  <path d="M4 4l10 10M14 4L4 14" />
                ) : (
                  <path d="M2.5 5.5h13M2.5 12.5h13" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="xl:hidden border-t border-border bg-background/95 backdrop-blur-xl">
          <div className="px-4 py-2 flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={link.href === '/admin' ? false : undefined}
                onClick={() => setOpen(false)}
                className={`py-3 text-[17px] border-b border-border last:border-0 ${
                  isActive(link.href) ? 'text-foreground font-medium' : 'text-muted'
                }`}
              >
                {t(link.en, link.zh)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
