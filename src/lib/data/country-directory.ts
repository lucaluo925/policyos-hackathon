import snapshot from './country-directory.json';
import {getMetrics,getMetricScore,type CategoryKey} from './metrics';

export interface DirectoryCountry {iso:string;iso3:string;name:string;capital:string|null;lat:number|null;lon:number|null;region:string;incomeGroup:string}
export const countryDirectory:DirectoryCountry[]=snapshot.countries;
export const directorySource={url:snapshot.sourceUrl,retrievedAt:snapshot.retrievedAt,provider:snapshot.provider,attribution:snapshot.attribution,datasetTermsUrl:snapshot.datasetTermsUrl};
export function getDirectoryCountry(iso:string){return countryDirectory.find(country=>country.iso===iso.toUpperCase());}
export function countryFlag(iso:string){return [...iso].map(letter=>String.fromCodePoint(127397+letter.charCodeAt(0))).join('');}
export function directoryScore(iso:string,category:CategoryKey):number|null{return getMetrics(iso)?getMetricScore(iso,category):null;}
export function directoryGeoJSON(category:CategoryKey):GeoJSON.FeatureCollection {
 return {type:'FeatureCollection',features:countryDirectory.flatMap(country=>{
  if(country.lat===null||country.lon===null||!Number.isFinite(country.lat)||!Number.isFinite(country.lon)||Math.abs(country.lat)>90||Math.abs(country.lon)>180)return [];
  const score=directoryScore(country.iso,category);
  return [{type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[country.lon,country.lat]},properties:{iso:country.iso,name:country.name,flag:countryFlag(country.iso),region:country.region,score,hasScore:score!==null}}];
 })};
}
