import type { Metadata } from 'next';
import MonitorClient from './MonitorClient';
export const metadata: Metadata = { title: 'Policy monitor | PolicyOS', description: 'Search official announcements, save watchlists and follow new policy updates.' };
export default function MonitorPage() { return <MonitorClient />; }
