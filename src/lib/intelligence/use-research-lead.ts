'use client';
import { useSyncExternalStore } from 'react';
import { readResearchLead, RESEARCH_LEAD_CHANGED, RESEARCH_LEAD_STORAGE_KEY } from './research-lead';

function snapshot(): string | null {
  try { return sessionStorage.getItem(RESEARCH_LEAD_STORAGE_KEY); } catch { return null; }
}
function subscribe(changed: () => void) {
  window.addEventListener('storage', changed);
  window.addEventListener(RESEARCH_LEAD_CHANGED, changed);
  return () => { window.removeEventListener('storage', changed); window.removeEventListener(RESEARCH_LEAD_CHANGED, changed); };
}
const serverSnapshot = (): null => null;

export function useResearchLead(expectedHeadline: string) {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return readResearchLead(raw, expectedHeadline);
}
export function clearResearchLead() {
  try { sessionStorage.removeItem(RESEARCH_LEAD_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
  window.dispatchEvent(new Event(RESEARCH_LEAD_CHANGED));
}
