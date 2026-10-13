import {createHash} from 'node:crypto';
import {parseFeed} from '@/lib/feeds/atom-parser';
import {classifyDomain} from '@/lib/feeds/classify';
import {resolveFeedItem} from '@/lib/feeds/registry';
import type {AnnouncementSource,OfficialAnnouncement,AnnouncementTopic} from './types';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function sourceCalendarDay(raw:string|null):string|null {
 const match=raw?.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?=\s|$)/);
 if(!match)return null;
 const month=MONTHS.findIndex(value=>value.slice(0,3).toLowerCase()===match[2].toLowerCase());
 if(month<0)return null;
 const year=Number(match[3]),day=Number(match[1]);const stamp=Date.UTC(year,month,day);const check=new Date(stamp);
 return check.getUTCFullYear()===year&&check.getUTCMonth()===month&&check.getUTCDate()===day?check.toISOString().slice(0,10):null;
}
function text(value:string){return value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&rsquo;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
function safeArticleUrl(raw:string,source:AnnouncementSource):string|null {
 try {const url=new URL(raw,source.url);if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  const host=url.hostname.replace(/^www\./,'');const root=new URL(source.url).hostname.replace(/^www\./,'');
  const canada=source.id.startsWith('canada-')&&host==='canada.ca';
  const allowed=source.allowedArticleHosts?.some(value=>host===value.toLowerCase().replace(/^www\./,''));
  if(host!==root&&!canada&&!allowed)return null;
  if(source.articlePathPrefix&&!url.pathname.startsWith(source.articlePathPrefix))return null;
  return url.href.length<=2048?url.href:null;
 }catch{return null;}
}
function item(source:AnnouncementSource,title:string,url:string,publishedAt:string,topic:AnnouncementTopic,datePrecision:'day'|'timestamp',dateKind:'published'|'updated'='published'):OfficialAnnouncement {
 return {id:createHash('sha256').update(source.id+'\n'+url).digest('hex').slice(0,24),sourceId:source.id,sourceName:source.name,country:source.countries[0],topic,title,url,publishedAt,datePrecision,dateKind,language:source.language,kind:'announcement'};
}
export function parseOfficialAnnouncements(source:AnnouncementSource,raw:string,now=Date.now()):OfficialAnnouncement[] {
 const out:OfficialAnnouncement[]=[];const seen=new Set<string>();
 if(source.format==='rss') {
  for(const entry of parseFeed(raw)) {
   const url=entry.link?safeArticleUrl(entry.link,source):null;const title=entry.title.trim();
   const sourceDay=source.publicationDayFromFeed?sourceCalendarDay(entry.sourceDate):null;
   const stamp=source.publicationDayFromFeed?Date.parse(sourceDay??''):Date.parse(entry.publishedAt);
   if(!url||!title||title.length>1000||source.excludeTitle?.test(title)||(source.includeTitle&&!source.includeTitle.test(title))||!Number.isFinite(stamp)||stamp>now+2*86400000)continue;
   const topic=source.legacyFeedKey?resolveFeedItem(source.legacyFeedKey,title,'climate'):source.topic==='auto'?classifyDomain(title):source.topic;
   if(!topic||seen.has(url))continue;seen.add(url);
   const datePrecision=entry.datePrecision==='day'||!!source.publicationDayTimeZone||!!source.publicationDayFromFeed?'day':'timestamp';
   const publishedAt=sourceDay??(source.publicationDayTimeZone
    ?new Intl.DateTimeFormat('sv-SE',{timeZone:source.publicationDayTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp))
    :datePrecision==='day'?entry.publishedAt.slice(0,10):new Date(stamp).toISOString());
   out.push(item(source,title,url,publishedAt,topic,datePrecision,entry.dateKind==='updated'?'updated':'published'));
  }
 }else {
  // Only a link immediately followed by an explicit source date qualifies.
  // Navigation labels and bare footer links cannot become news records.
  for(const match of raw.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
   const suffix=raw.slice(match.index+match[0].length,match.index+match[0].length+80);
   const date=suffix.match(/^\s*\[([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\]/);const href=match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i);
   if(!date||!href||Number(date[3])!==source.year)continue;
   const month=MONTHS.findIndex(value=>value.toLowerCase()===date[1].toLowerCase());const day=Number(date[2]);if(month<0)continue;
   const stamp=Date.UTC(Number(date[3]),month,day);const check=new Date(stamp);
   if(check.getUTCMonth()!==month||check.getUTCDate()!==day||stamp>now+2*86400000)continue;
   const url=safeArticleUrl(text(href[1]),source);const title=text(match[2]);
   if(!url||!title||title.length>1000||seen.has(url))continue;seen.add(url);out.push(item(source,title,url,check.toISOString().slice(0,10),'trade','day'));
  }
 }
 return out.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,50);
}
