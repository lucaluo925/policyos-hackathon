'use client';

import {useEffect,useState,useSyncExternalStore} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {countryDirectory as countries,countryFlag} from '@/lib/data/country-directory';
import {PIPELINE_COVERAGE} from '@/lib/pipeline/coverage';
import {ANNOUNCEMENT_SOURCES} from '@/lib/announcements/registry';
import type {AnnouncementBundle,AnnouncementTopic,OfficialAnnouncement} from '@/lib/announcements/types';
import {useLocale,useT} from '@/lib/i18n/client';
import {makeResearchLead,RESEARCH_LEAD_STORAGE_KEY,RESEARCH_LEAD_CHANGED} from '@/lib/intelligence/research-lead';

const subscribeHydration=()=>()=>{};
const configuredCountries=new Set([...PIPELINE_COVERAGE.map(source=>source.countryIso),...ANNOUNCEMENT_SOURCES.flatMap(source=>source.countries)]).size;
type ReadState={key:string;bundle:AnnouncementBundle|null;error:string|null};

export default function IntelligenceClient({initialCountry=''}:{initialCountry?:string}) {
 const t=useT();const locale=useLocale();const router=useRouter();
 const hydrated=useSyncExternalStore(subscribeHydration,()=>true,()=>false);
 const [country,setCountry]=useState(initialCountry);const [topic,setTopic]=useState<AnnouncementTopic|''>('');const [claim,setClaim]=useState('');
 const [readState,setReadState]=useState<ReadState|null>(null);const [refresh,setRefresh]=useState(0);
 const selectionKey=[country,topic,refresh].join(':');
 const bundle=readState?.key===selectionKey?readState.bundle:null;
 const readError=readState?.key===selectionKey?readState.error:null;
 const loading=!!country&&readState?.key!==selectionKey;
 const sources=PIPELINE_COVERAGE.filter(source=>(!country||source.countryIso===country)&&(!topic||source.domain===topic));
 const connectors=ANNOUNCEMENT_SOURCES.filter(source=>(!country||source.countries.includes(country))&&(!topic||source.topic==='auto'||source.topic===topic));
 useEffect(()=>{
  if(!country)return;
  const controller=new AbortController();
  const query=new URLSearchParams({country});if(topic)query.set('topic',topic);
  fetch('/api/announcements?'+query,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Announcements could not be loaded.');
   const result:AnnouncementBundle=await response.json();
   if(!controller.signal.aborted)setReadState({key:selectionKey,bundle:result,error:null});
  }).catch(()=>{if(!controller.signal.aborted)setReadState({key:selectionKey,bundle:null,error:'unavailable'});});
  return ()=>controller.abort();
 },[country,topic,selectionKey]);

 function openChecker(value:string,announcement?:OfficialAnnouncement) {
  if(!value.trim())return;
  try {
   const lead=announcement?makeResearchLead({claim:announcement.title,sourceUrl:announcement.url}):null;
   if(lead)sessionStorage.setItem(RESEARCH_LEAD_STORAGE_KEY,JSON.stringify(lead));else sessionStorage.removeItem(RESEARCH_LEAD_STORAGE_KEY);
   window.dispatchEvent(new Event(RESEARCH_LEAD_CHANGED));
  }catch{/* The checker still opens when session storage is unavailable. */}
  router.push('/verify?'+new URLSearchParams({claim:value.trim()}));
 }
 const dateLabel=(entry:OfficialAnnouncement)=>entry.datePrecision==='day'?entry.publishedAt:new Intl.DateTimeFormat(locale==='zh'?'zh-CN':'en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC',timeZoneName:'short'}).format(new Date(entry.publishedAt));
 return <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
  <div className="flex flex-wrap justify-between gap-4 mb-6"><div>
   <h1 className="text-3xl font-semibold">{t('Policy research workspace','政策研究工作台')}</h1>
   <p className="text-sm text-muted mt-2">{t('Read official announcements, refine a policy claim, and inspect its evidence.','阅读官方公告，明确政策声明，再核查原始证据。')}</p>
  </div><Link href="/explore" className="text-sm text-accent py-2">{t('Explore the policy map →','查看政策地图 →')}</Link></div>
  <p className="text-sm text-muted mb-6" data-testid="research-coverage">{t(`${countries.length} countries / economies in the directory · ${configuredCountries} countries / economies with configured sources · ${PIPELINE_COVERAGE.length} policy pipelines · ${ANNOUNCEMENT_SOURCES.length} announcement connectors`,`${countries.length} 个国家／经济体目录条目 · ${configuredCountries} 个国家／经济体配置来源 · ${PIPELINE_COVERAGE.length} 条政策管道 · ${ANNOUNCEMENT_SOURCES.length} 个公告连接器`)}</p>
  <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
   <form onSubmit={event=>{event.preventDefault();openChecker(claim);}} className="border border-border rounded-xl bg-surface-1 p-5 space-y-4 h-fit">
    <h2 className="font-semibold">{t('Investigate a precise claim','研究一个具体声明')}</h2>
    <label className="block text-sm">{t('Policy claim','政策声明')}<textarea disabled={!hydrated} value={claim} onChange={event=>setClaim(event.target.value)} maxLength={1000} required rows={5} className="mt-2 w-full border border-border rounded-lg bg-background p-3" placeholder={t('Include the country, policy and effective date you want to check.','写明要核对的国家、政策与生效日期。')} /></label>
    <button type="submit" disabled={!hydrated||!claim.trim()} className="min-h-11 rounded-lg bg-accent text-white px-4 disabled:opacity-50">{t('Open evidence checker','进入证据核验')}</button>
    <p className="text-xs text-muted">{t('Opening the checker makes no model call. Start each live verification yourself; sources and exact evidence are recorded with its result.','打开核验页不会调用模型。每次实时核验由你主动发起，结果会记录来源与实际证据。')}</p>
   </form>
   <div>
    <div className="flex flex-wrap gap-3 mb-4">
     <label className="text-sm min-w-0 max-w-full">{t('Country','国家')}<select aria-label={t('Source country','来源国家')} disabled={!hydrated} value={country} onChange={event=>setCountry(event.target.value)} className="block mt-1 min-h-11 max-w-full border border-border rounded-lg bg-background px-3"><option value="">{t('All countries','全部国家')}</option>{countries.map(item=><option key={item.iso} value={item.iso}>{countryFlag(item.iso)} {item.name}</option>)}</select></label>
     <label className="text-sm">{t('Topic','领域')}<select aria-label={t('Source topic','来源领域')} disabled={!hydrated} value={topic} onChange={event=>setTopic(event.target.value as AnnouncementTopic|'')} className="block mt-1 min-h-11 border border-border rounded-lg bg-background px-3"><option value="">{t('All topics','全部领域')}</option><option value="climate">{t('Climate','气候')}</option><option value="trade">{t('Trade','贸易')}</option><option value="immigration">{t('Immigration','移民')}</option></select></label>
    </div>
    <section className="mb-6" aria-label={t('Official announcements','官方公告')}>
     <div className="flex justify-between items-center gap-3 mb-2"><h2 className="font-semibold">{t('Official announcements','官方公告')}</h2>{country&&<button disabled={loading} onClick={()=>setRefresh(value=>value+1)} className="text-sm text-accent min-h-11 disabled:opacity-50">{t('Check sources','检查来源')}</button>}</div>
     <p className="text-xs text-muted mb-3">{t('Titles are research leads. Publication or update dates are not policy effective dates; an announcement does not establish that a policy is in force. Successful reads are cached for 10 minutes.','标题是研究线索。公告发布或更新日期不等于政策生效日期，公告也不证明政策已实施。成功读取的内容缓存 10 分钟。')}</p>
     {!country&&<p className="text-sm text-muted py-4">{t('Select a country to read its configured official sources.','选择国家，读取已配置的官方来源。')}</p>}
     {loading&&<p role="status" className="text-sm text-muted py-4">{t('Reading official sources…','正在读取官方来源…')}</p>}
     {readError&&<p role="status" className="text-sm text-muted py-4">{t('The source reader is unavailable. Try again or open the official links below.','来源读取暂不可用，请重试或打开下方官方链接。')}</p>}
     {bundle&&<>
      <div data-testid="announcement-source-status" className="space-y-2 mb-3">{bundle.sources.map(source=><div key={source.sourceId} className="text-xs text-muted border border-border rounded-lg p-3"><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{source.name}</a><p className="mt-1">{source.status==='available'?t('Read successfully','读取成功'):source.status==='retained'?t('Refresh failed; showing an earlier collection','更新失败，显示此前读取的内容'):t('Source unavailable','来源暂不可用')} · {source.fetchedAt?t('Collected: ','采集时间：')+new Date(source.fetchedAt).toLocaleString():t('No successful collection','尚未成功采集')}</p></div>)}</div>
      <div className="space-y-3" data-testid="announcement-list">{bundle.items.map(entry=><article key={entry.id} data-announcement-id={entry.id} className="border border-border rounded-xl bg-surface-1 p-4"><h3 className="text-sm font-semibold break-words">{entry.title}</h3><p className="text-xs text-muted mt-2">{entry.sourceName} · {entry.topic} · {entry.dateKind==='updated'?t('Updated: ','更新日期：'):t('Published: ','发布日期：')}<time dateTime={entry.publishedAt}>{dateLabel(entry)}</time></p><div className="flex flex-wrap gap-4 mt-2"><a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline min-h-11 inline-flex items-center">{t('Read original ↗','查看原文 ↗')}</a><button onClick={()=>openChecker(entry.title,entry)} className="text-sm text-accent min-h-11">{t('Investigate this announcement →','研究这条公告 →')}</button></div></article>)}</div>
      {bundle.items.length===0&&<p role="status" className="text-sm text-muted py-4">{bundle.sources.length===0?t('No automatic announcement connector is configured for this country yet. You can still check a precise claim.','这个国家尚未配置自动公告来源，仍可核对具体声明。'):bundle.sources.every(source=>source.status==='unavailable')?t('Configured sources could not be read. This does not mean there are no announcements.','已配置来源未能读取，这不代表该国没有公告。'):t('No matching announcements were found in the sources that could be read.','成功读取的来源中，未找到匹配当前领域的公告。')}</p>}
     </>}
    </section>
    <h2 className="font-semibold mb-2">{t('Configured source locations','已配置来源地址')}</h2>
    <p className="text-xs text-muted mb-4">{t('A configured pipeline is not proof of a current collection or verified policy. Source-country grouping does not establish legal applicability.','配置管道不代表刚刚采集或政策已经核验；来源所属国家也不证明政策的适用范围。')}</p>
    <div className="space-y-3" data-testid="policy-source-list">{sources.map(source=><article key={source.pipelineKey} className="border border-border rounded-xl bg-surface-1 p-4"><h3 className="text-sm font-semibold">{source.sourceName}</h3><p className="text-xs text-muted mt-1">{source.countryIso} · {source.domain} · {t('Policy pipeline','政策管道')}</p><div className="flex flex-wrap gap-4 mt-3 text-sm"><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{t('Read official source ↗','查看官方来源 ↗')}</a><Link href={'/countries/'+source.countryIso.toLowerCase()} className="text-accent">{t('Country profile →','国家资料 →')}</Link></div></article>)}{connectors.map(source=><article key={'announcement-'+source.id} className="border border-border rounded-xl bg-surface-1 p-4"><h3 className="text-sm font-semibold">{source.name}</h3><p className="text-xs text-muted mt-1">{source.countries.join(', ')} · {t('Announcement connector','公告连接器')}</p><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline mt-3 inline-block">{t('Read official source ↗','查看官方来源 ↗')}</a></article>)}{sources.length+connectors.length===0&&<p role="status" className="border border-border rounded-xl p-5 text-sm text-muted">{t('No source is configured for this selection yet. You can still investigate a precise claim with web retrieval.','当前选择尚未配置来源；仍可通过网页检索核对具体声明。')}</p>}</div>
   </div>
  </div>
 </section>;
}
