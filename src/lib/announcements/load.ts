import {announcementSourcesFor} from './registry';
import {parseOfficialAnnouncements} from './parse';
import type {AnnouncementBundle,AnnouncementSource,AnnouncementSourceResult,OfficialAnnouncement,AnnouncementTopic} from './types';
const FRESH_MS=10*60*1000,RETRY_MS=5*60*1000,RETAIN_MS=24*60*60*1000;
type CacheEntry={items:OfficialAnnouncement[];fetchedAt:number;checkedAt:number;problem:string|null};
export function createAnnouncementReader(transport:typeof fetch=fetch,clock:()=>number=Date.now){
 const cache=new Map<string,CacheEntry>();const pending=new Map<string,Promise<{items:OfficialAnnouncement[];state:AnnouncementSourceResult}>>();
 function describe(source:AnnouncementSource,entry:CacheEntry|undefined,now:number){
  const usable=!!entry&&entry.fetchedAt>0&&now-entry.fetchedAt<RETAIN_MS;
  const items=usable?entry.items:[];
  const state:AnnouncementSourceResult={sourceId:source.id,name:source.name,url:source.url,status:usable?(entry.problem?'retained':'available'):'unavailable',fetchedAt:entry?.fetchedAt?new Date(entry.fetchedAt).toISOString():null,checkedAt:new Date(entry?.checkedAt??now).toISOString(),records:items.length,problem:entry?.problem??null};
  return {items,state};
 }
 async function refresh(source:AnnouncementSource){
  const now=clock();const previous=cache.get(source.id);const wait=previous?.problem?RETRY_MS:FRESH_MS;
  if(previous&&now-previous.checkedAt<wait)return describe(source,previous,now);
  if(pending.has(source.id))return pending.get(source.id)!;
  const operation=(async()=>{
   try {
    const response=await transport(source.url,{headers:{'User-Agent':'PolicyOS/0.1 (+https://policyos-one.vercel.app)',Accept:'application/rss+xml,application/atom+xml,text/html'},signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok)throw Error(`Source returned HTTP ${response.status}`);
    if(Number(response.headers.get('content-length'))>1500000)throw Error('Source exceeds the read budget');
    const reader=response.body?.getReader();if(!reader)throw Error('Source returned no body');let total=0;const parts:Uint8Array[]=[];
    try{while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>1500000){await reader.cancel();throw Error('Source exceeds the read budget');}parts.push(chunk.value);}}finally{reader.releaseLock();}
    const bytes=Buffer.concat(parts);
    const declaredCharset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]
      ??bytes.subarray(0,160).toString('ascii').match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]
      ??'utf-8';
    const raw=new TextDecoder(declaredCharset).decode(bytes);
    if(source.format==='rss'&&!/<(?:rss|feed)\b/i.test(raw))throw Error('Source is not a feed');
    const items=parseOfficialAnnouncements(source,raw,clock());
    if(source.format==='miti-annual'&&items.length===0)throw Error('No explicitly dated media releases found');
    const fetchedAt=clock();cache.set(source.id,{items,fetchedAt,checkedAt:fetchedAt,problem:null});
   }catch(error){cache.set(source.id,{items:previous?.items??[],fetchedAt:previous?.fetchedAt??0,checkedAt:clock(),problem:error instanceof Error?error.message:'Source could not be read'});}
   return describe(source,cache.get(source.id),clock());
  })();pending.set(source.id,operation);try{return await operation;}finally{pending.delete(source.id);}
 }
 return async(country:string,topic?:AnnouncementTopic):Promise<AnnouncementBundle>=>{
  const sources=announcementSourcesFor(country);const results=[];
  // Bound upstream work to three source requests at a time per country query.
  for(let index=0;index<sources.length;index+=3)results.push(...await Promise.all(sources.slice(index,index+3).map(refresh)));
  const items=results.flatMap(result=>result.items.map(item=>({...item,country}))).filter(item=>!topic||item.topic===topic).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,50);
  return {country,checkedAt:new Date(clock()).toISOString(),items,sources:results.map(result=>result.state)};
 };
}
export const readOfficialAnnouncements=createAnnouncementReader();
