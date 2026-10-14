import type { MonitorQuery, MonitorResult } from './query';

/** Choose once from archive availability, not the filtered page size. An empty
 * archive uses official readers; an empty search/page in a populated archive
 * must not switch ID spaces or pagination cursors halfway through a result set.
 */
export async function selectMonitorSource(query: MonitorQuery, sources: {
  hasArchive: () => Promise<boolean>;
  archive: (query: MonitorQuery) => Promise<MonitorResult>;
  official: (query: MonitorQuery) => Promise<MonitorResult>;
}): Promise<MonitorResult> {
  return await sources.hasArchive() ? sources.archive(query) : sources.official(query);
}
