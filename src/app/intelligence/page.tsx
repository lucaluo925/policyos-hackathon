import type {Metadata} from 'next';
import IntelligenceClient from './IntelligenceClient';
import {getDirectoryCountry} from '@/lib/data/country-directory';
export const metadata:Metadata={title:'Policy research | PolicyOS',description:'Explore official policy sources and investigate precise claims with inspectable evidence.'};
export default async function IntelligencePage({searchParams}:{searchParams:Promise<{country?:string|string[]}>}){const query=await searchParams;const country=typeof query.country==='string'?getDirectoryCountry(query.country)?.iso:'';return <IntelligenceClient initialCountry={country||''} />;}
