import * as topojson from 'topojson-client';
import fs from 'node:fs';
const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json','utf8'));
const land = topojson.merge(topo, topo.objects.countries.geometries);   // MultiPolygon, no internal borders
const borders = topojson.mesh(topo, topo.objects.countries, (a,b)=>a!==b); // MultiLineString, country borders
fs.writeFileSync('land.json', JSON.stringify(land));
fs.writeFileSync('borders.json', JSON.stringify(borders));
console.log('land polys', land.coordinates.length, 'border lines', borders.coordinates.length);
