import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOfficialAnnouncements} from '../parse';
import {createAnnouncementReader} from '../load';
import {ANNOUNCEMENT_SOURCES} from '../registry';
import {parseFeed} from '../../feeds/atom-parser';
const now=Date.parse('2026-10-11T20:00:00Z');
const my=ANNOUNCEMENT_SOURCES.find(source=>source.id==='my-miti-2026')!;
const nz=ANNOUNCEMENT_SOURCES.find(source=>source.id==='nz-beehive')!;
const rss='<rss><channel><item><title>Government announces trade agreement</title><link>https://www.beehive.govt.nz/release/trade</link><pubDate>Sat, 10 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';

test('source publication date wins over a later update; absent dates stay unknown',()=>{
 const entries=parseFeed('<feed><entry><title>Trade</title><published>2026-10-01T00:00:00Z</published><updated>2026-10-10T00:00:00Z</updated></entry><entry><title>Update only</title><updated>2026-10-09T00:00:00Z</updated></entry><entry><title>Missing</title></entry><entry><title>Invalid</title><pubDate>bad</pubDate></entry></feed>');
 assert.equal(entries[0].publishedAt,'2026-10-01T00:00:00.000Z');assert.equal(entries[0].dateKind,'published');
 assert.equal(entries[1].dateKind,'updated');assert.equal(entries[2].publishedAt,'');assert.equal(entries[2].dateKind,'unknown');assert.equal(entries[3].publishedAt,'');
});
test('MITI accepts only valid immediately dated official links, without inventing an effective date',()=>{
 const html='<a href="/menu">Trade menu</a><a href="/release.pdf?a=1&amp;b=2">Trade &amp; industry</a>[October 1, 2026]<a href="/invalid">Bad date</a>[February 30, 2026]<a href="https://other.example/a">External</a>[October 2, 2026]<a href="/late">Unrelated date</a><p>[October 3, 2026]</p><a href="/release.pdf?a=1&amp;b=2">Duplicate</a>[October 1, 2026]';
 const items=parseOfficialAnnouncements(my,html,now);assert.equal(items.length,1);assert.equal(items[0].title,'Trade & industry');assert.equal(items[0].url,'https://www.miti.gov.my/release.pdf?a=1&b=2');assert.equal(items[0].publishedAt,'2026-10-01');assert.equal(items[0].datePrecision,'day');assert.equal(items[0].kind,'announcement');assert.ok(!('effectiveDate' in items[0]));
});
test('RSS rejects undated, unsafe, unrelated-topic and future entries; keeps an update date labelled',()=>{
 const entry=(title:string,url:string,date:string)=>`<item><title>${title}</title><link>${url}</link>${date}</item>`;
 const xml='<rss>'+entry('Trade agreement','https://www.beehive.govt.nz/a','<updated>2026-10-10T00:00:00Z</updated>')+entry('Trade agreement','https://www.beehive.govt.nz/b','')+entry('Trade agreement','https://other.example/c','<pubDate>2026-10-10</pubDate>')+entry('Trade agreement','javascript:alert(1)','<pubDate>2026-10-10</pubDate>')+entry('Trade agreement','https://www.beehive.govt.nz/future','<pubDate>2027-01-01</pubDate>')+entry('A birthday reception','https://www.beehive.govt.nz/d','<pubDate>2026-10-10</pubDate>')+'</rss>';
 const items=parseOfficialAnnouncements(nz,xml,now);assert.equal(items.length,1);assert.equal(items[0].dateKind,'updated');
});
test('parallel reads share collection; failure retains the original collection time, expires and recovers',async()=>{
 let time=now,calls=0,failed=false;
 const transport=(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return failed?new Response('down',{status:503}):new Response(rss);}) as typeof fetch;
 const read=createAnnouncementReader(transport,()=>time);
 const [a,b]=await Promise.all([read('NZ'),read('NZ','trade')]);assert.equal(calls,1);assert.equal(a.items.length,1);assert.equal(b.items.length,1);
 const fetchedAt=a.sources[0].fetchedAt;time+=11*60*1000;failed=true;
 const retained=await read('NZ');assert.equal(retained.sources[0].status,'retained');assert.equal(retained.sources[0].fetchedAt,fetchedAt);assert.equal(retained.items.length,1);
 await read('NZ');assert.equal(calls,2);
 time+=24*60*60*1000;const expired=await read('NZ');assert.equal(expired.sources[0].status,'unavailable');assert.equal(expired.items.length,0);
 time+=6*60*1000;failed=false;const recovered=await read('NZ');assert.equal(recovered.sources[0].status,'available');assert.notEqual(recovered.sources[0].fetchedAt,fetchedAt);
});
test('empty topic matches differ from failed reads and a country without a connector',async()=>{
 const read=createAnnouncementReader((async()=>new Response('<rss><channel/></rss>')) as typeof fetch,()=>now);
 const empty=await read('NZ');assert.equal(empty.sources[0].status,'available');assert.equal(empty.items.length,0);
 const none=await read('PS');assert.equal(none.sources.length,0);
 const broken=createAnnouncementReader((async()=>new Response('<html>blocked</html>')) as typeof fetch,()=>now);
 const failure=await broken('NZ');assert.equal(failure.sources[0].status,'unavailable');assert.match(failure.sources[0].problem!,/not a feed/);
});
test('response size budget applies to declared and streamed bodies',async()=>{
 for(const response of [new Response('x',{headers:{'content-length':'1500001'}}),new Response('x'.repeat(1500001))]){
  const read=createAnnouncementReader((async()=>response) as typeof fetch,()=>now);const result=await read('NZ');assert.equal(result.sources[0].status,'unavailable');assert.match(result.sources[0].problem!,/read budget/);assert.equal(result.items.length,0);
 }
});
test('Swiss date-only announcements retain a day and allow only the registered official article host',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='ch-federal-en')!;
 const entry=(url:string,date='2026-10-01')=>`<item><title>Free trade agreement</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
 const xml='<rss>'+entry('https://www.admin.ch/en/newnsb/example')+entry('https://admin.ch.evil.example/article')+entry('https://admin.ch@evil.example/article')+entry('https://admin.ch:8443/article')+entry('https://evil.example/?source=admin.ch')+entry('http://www.admin.ch/article')+entry('https://www.admin.ch/invalid','2026-02-30')+'</rss>';
 const result=parseOfficialAnnouncements(source,xml,now);
 assert.equal(result.length,1);assert.equal(result[0].datePrecision,'day');assert.equal(result[0].publishedAt,'2026-10-01');assert.equal(result[0].country,'CH');
 assert.equal(parseOfficialAnnouncements({...source,allowedArticleHosts:[]},xml,now).length,0);
});
test('an RSS source day has no inferred time and invalid source days remain unknown',()=>{
 const entries=parseFeed('<rss><item><title>Trade</title><pubDate>2026-10-01</pubDate></item><item><title>Trade</title><pubDate>2026-02-30</pubDate></item><item><title>Trade</title><pubDate>2026-10-01T10:30:00+02:00</pubDate></item></rss>');
 assert.equal(entries[0].datePrecision,'day');assert.equal(entries[1].publishedAt,'');assert.equal(entries[1].datePrecision,'unknown');assert.equal(entries[2].datePrecision,'timestamp');assert.equal(entries[2].publishedAt,'2026-10-01T08:30:00.000Z');
});
test('Hong Kong routine enforcement does not become trade policy but an import restriction remains a lead',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='hk-government-en')!;
 const entry=(title:string,id:number)=>`<item><title>${title}</title><link>https://www.info.gov.hk/gia/general/202610/10/P${id}.htm</link><pubDate>2026-10-10T10:00:00+08:00</pubDate></item>`;
 const items=parseOfficialAnnouncements(source,'<rss>'+entry('Hong Kong Customs detects drug trafficking case',1)+entry('Two employers sanctioned for violating labour scheme requirements',2)+entry('Import of poultry meat and products from affected areas suspended',3)+entry('Hong Kong Customs arrests company director over false trade descriptions',4)+entry('Hong Kong Customs detects case involving precious metals transactions without registration',5)+entry('Hong Kong Customs conducts interdepartmental anti-illicit cigarette publicity campaigns',6)+'</rss>',now);
 assert.equal(items.length,1);assert.equal(items[0].topic,'trade');assert.equal(items[0].country,'HK');assert.match(items[0].title,/Import of poultry/);assert.ok(!('effectiveDate' in items[0]));
});
test('Slovenia official RSS yields dated policy leads and rejects unrelated or off-host stories',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='si-government-en')!;
 assert.equal(source.url,'https://www.gov.si/en/news/rss/');
 const entry=(title:string,url:string)=>`<item><title>${title}</title><link>${url}</link><pubDate>Fri, 09 Oct 2026 17:00:00 +0200</pubDate></item>`;
 const xml='<rss><channel>'+entry('Government proposes a new migration rule','https://www.gov.si/en/news/2026-10-09-migration-rule/')+entry('Sports championship celebrated','https://www.gov.si/en/news/2026-10-09-sports/')+entry('Government announces migration rule','https://lookalike.example/en/news/migration/')+'</channel></rss>';
 const result=parseOfficialAnnouncements(source,xml,now);
 assert.equal(result.length,1);
 assert.equal(result[0].country,'SI');
 assert.equal(result[0].topic,'immigration');
 assert.equal(result[0].publishedAt,'2026-10-09T15:00:00.000Z');
 assert.equal(result[0].dateKind,'published');
 assert.equal(result[0].url,'https://www.gov.si/en/news/2026-10-09-migration-rule/');
});
test('Singapore trade circulars retain the source day and exclude unrelated operational notices',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='sg-sfa-trade-circulars')!;
 const entry=(title:string,url:string,date:string)=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
 const base='https://www.sfa.gov.sg/news-publications/circulars-and-notices/circulars/';
 const xml='<rss><channel>'+
  entry('Trade Circular on HPAI import restrictions',base+'hpai','08 Oct 2026 06:07 AM')+
  entry('Circular - House Rules at Jurong Fishery Port',base+'house-rules','07 Oct 2026 10:00 PM')+
  entry('Trade Circular on imported meat',base+'invalid','31 Feb 2026 06:07 AM')+
  entry('Trade Circular on exports','https://fake-sfa.gov.sg.example/notice','08 Oct 2026 06:07 AM')+
  '</channel></rss>';
 const result=parseOfficialAnnouncements(source,xml,now);
 assert.equal(result.length,1);
 assert.equal(result[0].country,'SG');assert.equal(result[0].topic,'trade');
 assert.equal(result[0].publishedAt,'2026-10-08');assert.equal(result[0].datePrecision,'day');
 assert.equal(result[0].url,base+'hpai');
});
test('Irish immigration feed retains a dated scheme announcement but omits routine service notices',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='ie-immigration-service')!;
 const entry=(title:string,path:string)=>`<item><title>${title}</title><link>https://www.irishimmigration.ie/${path}/</link><pubDate>Wed, 30 Sep 2026 10:31:01 +0000</pubDate></item>`;
 const xml='<rss><channel>'+
  entry('Temporary Protection Transition Scheme (TPTS) Opens for Applications','temporary-protection-transition-scheme-tpts-opens-for-applications')+
  entry('Burgh Quay Registration Office Closed','office-closed')+
  entry('Important Security Update: Multi-Factor Authentication (MFA) added to the ISD Customer Service Portal','portal-mfa')+
  `<item><title>Temporary Protection Transition Scheme</title><link>https://outside.example/forged</link><pubDate>Wed, 30 Sep 2026 10:31:01 +0000</pubDate></item>`+
  '</channel></rss>';
 const items=parseOfficialAnnouncements(source,xml,now);
 assert.equal(items.length,1);
 assert.equal(items[0].country,'IE');
 assert.equal(items[0].topic,'immigration');
 assert.equal(items[0].publishedAt,'2026-09-30T10:31:01.000Z');
 assert.equal(items[0].url,'https://www.irishimmigration.ie/temporary-protection-transition-scheme-tpts-opens-for-applications/');
});
test('Spanish official gazette is decoded from its declared Latin-1 charset',async()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='es-boe-immigration')!;
 const xml=`<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Extranjería: resolución de protección</title><link>https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20743</link><pubDate>Tue, 06 Oct 2026 00:00:00 +0200</pubDate></item></channel></rss>`;
 const latin1=Uint8Array.from(Buffer.from(xml,'latin1'));
 const read=createAnnouncementReader((async()=>new Response(latin1,{headers:{'content-type':'application/rss+xml; charset=ISO-8859-1'}})) as typeof fetch,()=>now);
 const result=await read('ES','immigration');
 assert.equal(result.sources.find(value=>value.sourceId===source.id)?.status,'available');
 assert.equal(result.items.length,1);
 assert.equal(result.items[0].title,'Extranjería: resolución de protección');
 assert.equal(result.items[0].url,'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20743');
 assert.equal(result.items[0].publishedAt,'2026-10-06');
 assert.equal(result.items[0].datePrecision,'day');
 assert.equal(result.items[0].language,'es');
});
test('French ecology feed keeps a dated policy lead, not an event or quiz',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='fr-ecologie-news')!;
 const entry=(title:string,path:string)=>`<item><title>${title}</title><link>https://www.ecologie.gouv.fr/actualites/${path}</link><pubDate>Mon, 05 Oct 2026 14:39:42 +0200</pubDate></item>`;
 const xml='<rss><channel>'+entry('Haies : un régime unique pour mieux les protéger','haies-regime-unique')+entry('Quiz : testez vos connaissances sur la qualité de l’air','quiz')+entry('Conférence sur le climat','conference')+'</channel></rss>';
 const items=parseOfficialAnnouncements(source,xml,now);
 assert.equal(items.length,1);
 assert.equal(items[0].country,'FR');assert.equal(items[0].topic,'climate');
 assert.equal(items[0].url,'https://www.ecologie.gouv.fr/actualites/haies-regime-unique');
 assert.equal(items[0].dateKind,'published');
 assert.equal(parseOfficialAnnouncements(source,'<rss>'+entry('Énergie : nouveau régime de soutien','energie-soutien')+'</rss>',now).length,1);
});
test('Italian civil-protection feed keeps one official weather measure, not duplicated or unrelated orders',()=>{
 const source=ANNOUNCEMENT_SOURCES.find(value=>value.id==='it-civil-protection-weather')!;
 const entry=(title:string,url:string)=>`<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>Fri, 02 Oct 2026 14:22:45 GMT</pubDate></item>`;
 const title='Ocdpc n. 1220 - Ulteriori interventi urgenti in conseguenza degli eccezionali eventi meteorologici';
 const xml='<rss><channel>'+
  entry(title,'https://www.protezionecivile.gov.it/en/normativa/ocdpc-n-1220/index.html')+
  entry(title,'https://www.protezionecivile.gov.it/it/normativa/ocdpc-n-1220/index.html')+
  entry('Ordinanza per emergenza terremoto','https://www.protezionecivile.gov.it/en/normativa/earthquake/index.html')+
  entry(title,'https://protezionecivile.gov.it.evil.example/en/normativa/forged')+
  '</channel></rss>';
 const items=parseOfficialAnnouncements(source,xml,now);
 assert.equal(items.length,1);
 assert.equal(items[0].country,'IT');assert.equal(items[0].topic,'climate');
 assert.equal(items[0].url,'https://www.protezionecivile.gov.it/en/normativa/ocdpc-n-1220/index.html');
 assert.ok(!('effectiveDate' in items[0]));
 assert.equal(parseOfficialAnnouncements(source,'<rss>'+entry('Misure urgenti per la siccità','https://www.protezionecivile.gov.it/en/normativa/siccita/index.html')+'</rss>',now).length,1);
});
