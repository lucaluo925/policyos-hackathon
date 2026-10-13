import {NextResponse} from 'next/server';
import {getDirectoryCountry} from '@/lib/data/country-directory';
import {readOfficialAnnouncements} from '@/lib/announcements/load';
import type {AnnouncementTopic} from '@/lib/announcements/types';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(request:Request){
 const query=new URL(request.url).searchParams;const country=query.get('country')?.toUpperCase();const topic=query.get('topic')||undefined;
 if(!country||!getDirectoryCountry(country)||(topic&&!['trade','climate','immigration'].includes(topic)))return NextResponse.json({error:'Choose a valid country and topic.'},{status:400});
 return NextResponse.json(await readOfficialAnnouncements(country,topic as AnnouncementTopic|undefined),{headers:{'Cache-Control':'no-store'}});
}
