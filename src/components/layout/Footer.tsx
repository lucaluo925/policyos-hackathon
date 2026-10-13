import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

export default async function Footer() {
  const { t } = await getT();
  const sourceRepoUrl = process.env.SOURCE_REPO_URL;
  return (
    <footer className="border-t border-border bg-surface">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-foreground flex items-center justify-center text-background font-semibold text-sm">P</div>
              <span className="text-lg font-semibold tracking-tight">PolicyOS</span>
            </div>
            <p className="text-muted text-sm max-w-md">
              {t('Tracking and comparing government policies across climate, trade, and immigration domains worldwide, with an evidence trail behind every change.', '追踪和比较各国在气候、贸易、移民领域的政府政策，每一次变化都附带可核查的证据链。')}
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3">{t('Platform', '平台')}</h4>
            <div className="flex flex-col gap-2">
              <Link href="/explore" className="text-sm text-muted hover:text-foreground transition-colors">{t('Global Map', '全球地图')}</Link>
              <Link href="/compare" className="text-sm text-muted hover:text-foreground transition-colors">{t('Compare Countries', '国家对比')}</Link>
              <Link href="/news" className="text-sm text-muted hover:text-foreground transition-colors">{t('Policy News', '政策动态')}</Link>
              <Link href="/contribute" className="text-sm text-muted hover:text-foreground transition-colors">{t('Contribute', '贡献数据')}</Link>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-3">{t('Resources', '资源')}</h4>
            <div className="flex flex-col gap-2">
              <Link href="/research" className="text-sm text-muted hover:text-foreground transition-colors">{t('Research & methodology', '研究与方法')}</Link>
              <a href="/api/events/export?relevant=1" className="text-sm text-muted hover:text-foreground transition-colors">{t('Open data: policy events (CSV)', '开放数据：政策事件（CSV）')}</a>
              {sourceRepoUrl && <a href={sourceRepoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-muted hover:text-foreground transition-colors">{t('Public source code', '公开源码')}</a>}
            </div>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-border flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-muted">&copy; 2026 PolicyOS · {t('Evidence-first policy intelligence', '证据优先的政策情报')}</p>
          <p className="text-xs text-muted">{t('Official source links · estimated scores are labelled', '提供官方来源链接 · 估算分数均有标注')}</p>
        </div>
      </div>
    </footer>
  );
}
