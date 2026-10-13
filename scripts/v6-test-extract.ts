/**
 * Directly fetch a URL and run the V6 deep extractor + mapper, to isolate
 * whether regex/rule issues or fetch issues cause zero numeric values.
 */
import { fetchAndDeepExtract } from '../src/lib/pipeline/helpers/deep-fetcher';
import { applyV6Rules } from '../src/lib/scoring/mapping';

async function main() {
  const urls = [
    'https://www.gov.uk/government/news/64-million-for-port-talbot-offshore-wind-hub-in-the-celtic-sea',
    'https://www.gov.uk/government/news/government-approves-uks-largest-power-producing-solar-farm',
    'https://www.gov.uk/government/news/hydrogen-investment-fuels-south-yorkshires-next-industrial-era',
  ];
  for (const url of urls) {
    console.log('\n=== ', url);
    const dr = await fetchAndDeepExtract(url, { timeoutMs: 20_000 });
    if (!dr.ok) {
      console.log('  FETCH FAILED:', dr.failureType, dr.error);
      continue;
    }
    const ex = dr.extraction!;
    console.log('  cleanBody.length:', ex.cleanBody.length);
    console.log('  policyType:', ex.policyType);
    console.log('  effectiveDate:', ex.effectiveDate);
    console.log('  numericValues:', JSON.stringify(ex.numericValues));
    console.log('  actions (first 3):', ex.actions.slice(0, 3));
    console.log('  body[0..600]:', ex.cleanBody.slice(0, 600));
    // Apply V6 rules
    const hints = applyV6Rules({
      domain: 'climate',
      actions: ex.actions,
      numericValues: ex.numericValues,
      bodyText: ex.cleanBody,
    });
    console.log('  V6 hints:', JSON.stringify(hints));
  }
}
main().catch(console.error);
