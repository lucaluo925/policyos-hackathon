import {FEED_REGISTRY,feedCountries} from '@/lib/feeds/registry';
import type {AnnouncementSource} from './types';
export const ANNOUNCEMENT_SOURCES:AnnouncementSource[]=[
 ...FEED_REGISTRY.map(feed=>({id:feed.key,name:feed.source,url:feed.url,countries:feedCountries(feed),topic:feed.domain,language:feed.lang||'en',format:'rss' as const,legacyFeedKey:feed.key})),
 {id:'my-miti-2026',name:'Malaysia MITI — 2026 media releases',url:'https://www.miti.gov.my/index.php/pages/view/10936',countries:['MY'],topic:'trade',language:'en/ms',format:'miti-annual',year:2026},
 {id:'nz-beehive',name:'New Zealand Government — Beehive announcements',url:'https://www.beehive.govt.nz/rss.xml',countries:['NZ'],topic:'auto',language:'en',format:'rss'},
 // The Department of Justice's Immigration Service Delivery publishes this
 // public feed. Keep operational office/portal updates out of policy leads.
 {id:'ie-immigration-service',name:'Ireland Immigration Service Delivery — news',url:'https://www.irishimmigration.ie/feed/',countries:['IE'],topic:'immigration',language:'en',format:'rss',includeTitle:/\b(?:visa|permit|scheme|policy|reunification|protection|asylum|residen(?:ce|cy|t)|immigration|registration rules?)\b/i,excludeTitle:/\b(?:office closed|citizenship ceremon(?:y|ies)|multi-factor authentication|customer service portal)\b/i},
 // Public official feeds independently discovered and read on 2026-10-12 UTC.
 // These are research leads, not assertions that an announced policy is in force.
 {id:'hk-government-en',name:'Hong Kong SAR Government — English press releases',url:'https://www.info.gov.hk/gia/rss/general_en.xml',countries:['HK'],topic:'auto',language:'en',format:'rss',excludeTitle:/drug trafficking|customs detects?.*\bcase\b|publicity campaigns?|arrests?|seiz(?:e|es|ed|ure)|suspected|false trade descriptions|employers sanctioned|\bfined\b|convicted|prosecuted/i},
 {id:'ch-federal-en',name:'Swiss Federal Government — English media releases',url:'https://d-nsbc-p.admin.ch/NSBSubscriber/feeds/rss?lang=en&org-nr=1&topic=&kind=M',countries:['CH'],topic:'auto',language:'en',format:'rss',allowedArticleHosts:['admin.ch']},
 {id:'no-government-en',name:'Norwegian Government — English news',url:'https://www.regjeringen.no/en/rss/Rss/2581966/?documentType=aktuelt/nyheter',countries:['NO'],topic:'auto',language:'en',format:'rss'},
 {id:'za-government-news',name:'South African Government News Agency — SAnews',url:'https://www.sanews.gov.za/rss.xml',countries:['ZA'],topic:'auto',language:'en',format:'rss'},
 {id:'za-dsti',name:'South Africa DSTI — news and announcements',url:'https://www.dsti.gov.za/rss.xml',countries:['ZA'],topic:'auto',language:'en',format:'rss'},
 // The official GOV.SI news page advertises this English RSS URL. Keep only
 // headlines matching a tracked domain; the article remains a research lead.
 {id:'si-government-en',name:'Slovenia GOV.SI — English news',url:'https://www.gov.si/en/news/rss/',countries:['SI'],topic:'auto',language:'en',format:'rss'},
 // SFA's trade-circular feed uses timezone-less local wall times. Display
 // its explicit source calendar day instead of guessing an offset. Operational
 // fishery-port and tenancy circulars do not become trade-policy leads.
 {id:'sg-sfa-trade-circulars',name:'Singapore Food Agency — trade circulars',url:'https://www.sfa.gov.sg/rss/annual-listing-circulars',countries:['SG'],topic:'trade',language:'en',format:'rss',publicationDayFromFeed:true,includeTitle:/\btrade circular\b|\bimport(?:ed|ation|s)?\b|\bexport(?:ed|ation|s|ers)?\b|\bsource countr(?:y|ies)\b|\bhealth certificate\b|\bregistration requirements\b/i},
 // Spain's official gazette provides topic feeds of dated publications. A
 // publication is a research lead; BOE also republishes EU legislation, so
 // country grouping alone does not establish Spanish legal applicability.
 {id:'es-boe-trade',name:'Spain BOE — trade legislation publications',url:'https://www.boe.es/rss/canal_leg.php?c=105&l=l',countries:['ES'],topic:'trade',language:'es',format:'rss',publicationDayTimeZone:'Europe/Madrid'},
 {id:'es-boe-environment',name:'Spain BOE — environmental legislation publications',url:'https://www.boe.es/rss/canal_leg.php?c=119&l=l',countries:['ES'],topic:'climate',language:'es',format:'rss',publicationDayTimeZone:'Europe/Madrid'},
 {id:'es-boe-immigration',name:'Spain BOE — immigration legislation publications',url:'https://www.boe.es/rss/canal_leg.php?c=135&l=l',countries:['ES'],topic:'immigration',language:'es',format:'rss',publicationDayTimeZone:'Europe/Madrid'},
 // The ecology ministry advertises this public feed. Select policy-relevant
 // environmental headlines rather than treating every ministry event as policy.
 {id:'fr-ecologie-news',name:'France Ecology Ministry — policy news',url:'https://www.ecologie.gouv.fr/rss-actualites.xml',countries:['FR'],topic:'climate',language:'fr',format:'rss',includeTitle:/(?:\b(?:climat|environnement|biodiversité|décret|réglementation|régime|réforme|stratégie|plan national|transition écologique)\b|énergie|émissions)/i,excludeTitle:/\b(?:quiz|agenda|élections professionnelles|webinaire|conférence)\b/i},
 // The civil-protection department advertises a regulation feed with paired
 // Italian/English links. Keep the English link once and only weather-risk
 // measures; these are announcements, not proof of Gazette publication or force.
 {id:'it-civil-protection-weather',name:'Italy Civil Protection — weather emergency measures',url:'https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=normativa',countries:['IT'],topic:'climate',language:'it',format:'rss',allowedArticleHosts:['protezionecivile.gov.it'],articlePathPrefix:'/en/normativa/',includeTitle:/(?:\b(?:eventi meteorologici|alluvion\w*|idrogeologic\w*|climatic\w*)\b|siccità)/i},
];
export function announcementSourcesFor(country:string){return ANNOUNCEMENT_SOURCES.filter(source=>source.countries.includes(country));}
