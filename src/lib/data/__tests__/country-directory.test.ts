import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countryDirectory,directoryGeoJSON,directoryScore,directorySource,getDirectoryCountry} from '../country-directory';
test('global geography excludes aggregates and missing coordinates, without inventing zero scores',()=>{
 assert.equal(countryDirectory.length,217);assert.equal(new Set(countryDirectory.map(row=>row.iso)).size,217);
 const map=directoryGeoJSON('trade');assert.equal(map.features.length,211);
 assert.equal(map.features.filter(feature=>feature.properties?.hasScore).length,15);
 assert(!map.features.some(feature=>feature.properties?.iso==='PS'));
 assert.equal(directoryScore('MY','trade'),null);
 assert.equal(map.features.find(feature=>feature.properties?.iso==='MY')?.properties?.score,null);
 assert(getDirectoryCountry('my'));assert(getDirectoryCountry('ps'));
});
test('all valid geographic coordinates stay bounded and curated profiles retain scores',()=>{
 for(const feature of directoryGeoJSON('climate').features){const point=feature.geometry as GeoJSON.Point;assert(Math.abs(point.coordinates[0])<=180);assert(Math.abs(point.coordinates[1])<=90);}
 assert.equal(typeof directoryScore('US','climate'),'number');assert.equal(getDirectoryCountry('unknown'),undefined);
});
test('country directory carries source, terms and attribution when shared',()=>{
 assert.match(directorySource.url,/^https:\/\/api\.worldbank\.org\/v2\/country/);
 assert.equal(directorySource.attribution,'The World Bank: Countries: World Bank Country API');
 assert.equal(directorySource.datasetTermsUrl,'https://www.worldbank.org/ext/en/legal/terms-conditions/datasets');
});
test('bundled country polygons only select unambiguous directory locations',()=>{
 const basemap=JSON.parse(readFileSync(new URL('../../../../public/map/natural-earth-50m-basemap.geojson',import.meta.url),'utf8')) as GeoJSON.FeatureCollection;
 const selected=basemap.features.map(feature=>feature.properties?.iso).filter((iso):iso is string=>typeof iso==='string');
 const directoryIso=new Set(countryDirectory.map(country=>country.iso));
 assert.equal(basemap.features.length,242);
 assert.equal(selected.length,188);
 assert.equal(new Set(selected).size,selected.length);
 assert(selected.every(iso=>directoryIso.has(iso)));
 assert(selected.includes('US'));
 assert(selected.includes('IN'));
});
