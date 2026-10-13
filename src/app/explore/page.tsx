'use client';

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { countries } from '@/lib/data/countries';
import {countryDirectory,getDirectoryCountry,directoryGeoJSON,directoryScore,countryFlag,directorySource} from '@/lib/data/country-directory';
import { ANNOUNCEMENT_SOURCES } from '@/lib/announcements/registry';
import { PIPELINE_COVERAGE } from '@/lib/pipeline/coverage';
import { getMetricScore, getMetrics, type CategoryKey, getCategoryColor } from '@/lib/data/metrics';
import { getPoliciesByCountry } from '@/lib/data/policies';
// The map panel shows category scores and links to the country page for the
// per-metric detail, so formatMetricValue and metricDefinitions are not used
// here; they were imported by an earlier version of this panel.
import { formatGDP, formatPopulation } from '@/lib/format';
import { getCountryFreshness, getFreshnessLabel } from '@/lib/freshness';
import { useLocale, useT } from '@/lib/i18n/client';
import { countryName, COUNTRY_ZH } from '@/lib/i18n';
import { zhData } from '@/lib/i18n/data-zh';
import SourceReadCheck from '@/components/SourceReadCheck';
import CountryResearch from '@/components/CountryResearch';

const FRESHNESS_CONFIG: Record<string, { text: string; color: string; icon: string }> = {
  verified: { text: 'Verified', color: '#10B981', icon: '✓' },
  recently_reviewed: { text: 'Recently reviewed', color: '#3B82F6', icon: '↻' },
  pending_verification: { text: 'Pending verification', color: '#EAB308', icon: '⏳' },
  potentially_stale: { text: 'Potentially stale', color: '#F97316', icon: '⚠' },
  unknown: { text: 'Unverified', color: '#6B7280', icon: '?' },
};

const CATEGORIES: { key: CategoryKey; label: string; zh: string; color: string }[] = [
  { key: 'climate', label: 'Climate & Environment', zh: '气候与环境', color: '#10B981' },
  { key: 'trade', label: 'Trade & Tariffs', zh: '贸易与关税', color: '#3B82F6' },
  { key: 'immigration', label: 'Immigration & Borders', zh: '移民与边境', color: '#8B5CF6' },
];

const SOURCE_ID = 'countries-source';
const CIRCLE_LAYER = 'countries-circles';
const LABEL_LAYER = 'countries-labels';
type CoverageFilter = 'all' | 'sources' | 'scores';

const configuredSourceCountries = new Set([...ANNOUNCEMENT_SOURCES.flatMap(source => source.countries), ...PIPELINE_COVERAGE.map(source => source.countryIso)]);
const buildGeoJSON = (category: CategoryKey, filter: CoverageFilter): GeoJSON.FeatureCollection => {
  const collection = directoryGeoJSON(category);
  return { ...collection, features: collection.features
    .filter(feature => filter === 'all'
      || (filter === 'sources' && configuredSourceCountries.has(String(feature.properties?.iso)))
      || (filter === 'scores' && feature.properties?.hasScore === true))
    .map(feature => ({ ...feature, properties: { ...feature.properties, hasSource: configuredSourceCountries.has(String(feature.properties?.iso)) } })) };
};
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export default function ExplorePage() {
  const interactive = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const t = useT();
  const locale = useLocale();
  const zd = zhData(locale);
  const catLabel = (k: CategoryKey) => { const c = CATEGORIES.find((x) => x.key === k)!; return t(c.label, c.zh); };
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('climate');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('all');
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [countryQuery,setCountryQuery]=useState('');
  const geojson = useMemo(() => buildGeoJSON(activeCategory, coverageFilter), [activeCategory, coverageFilter]);
  const visibleDirectory = countryDirectory.filter(country => coverageFilter === 'all'
    || (coverageFilter === 'sources' && configuredSourceCountries.has(country.iso))
    || (coverageFilter === 'scores' && directoryScore(country.iso, activeCategory) !== null));
  const catColor = CATEGORIES.find(c => c.key === activeCategory)!.color;

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Register the separate module worker as a build asset.
    maplibregl.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href);

    const darkMap = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'natural-earth': {
            type: 'geojson',
            data: '/map/natural-earth-50m-basemap.geojson',
            attribution: '<a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer">Natural Earth</a> (public domain)',
          },
        },
        layers: [
          { id: 'map-ocean', type: 'background', paint: { 'background-color': darkMap ? '#101722' : '#e8f0f5' } },
          { id: 'map-land', type: 'fill', source: 'natural-earth',
            paint: { 'fill-color': darkMap ? '#1d2a3a' : '#f7f8f8' } },
          { id: 'map-borders', type: 'line', source: 'natural-earth',
            paint: { 'line-color': darkMap ? '#4c5b70' : '#a8b7c4', 'line-width': 0.75 } },
        ],
      },
      center: [0, 15],
      zoom: Math.max(0, Math.log2(Math.max(256, mapContainer.current.clientWidth - 32) / 512)),
      minZoom: 0,
      maxZoom: 8,
    });

    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    const describeCenter=()=>{const center=m.getCenter();m.getContainer().dataset.centerLat=String(center.lat);m.getContainer().dataset.centerLon=String(center.lng);};
    m.on('moveend',describeCenter);

    m.on('load', () => {
      // Add the GeoJSON source
      m.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildGeoJSON('climate', 'all'),
      });

      // Circle layer — radius based on score
      m.addLayer({
        id: CIRCLE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['case',['get','hasScore'],[
            'interpolate', ['linear'], ['get', 'score'],
            0, 8,
            50, 14,
            100, 22,
          ],['case',['get','hasSource'],7,4]],
          'circle-color': ['case',['get','hasScore'],'#10B981',['get','hasSource'],'#60A5FA','#9CA3AF'],
          'circle-opacity': ['case',['get','hasScore'],[
            'interpolate', ['linear'], ['get', 'score'],
            0, 0.25,
            100, 0.85,
          ],0.65],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case',['get','hasScore'],'#10B981',['get','hasSource'],'#60A5FA','#9CA3AF'],
          'circle-stroke-opacity': 0.9,
        },
      });

      // Label layer — show score number
      m.addLayer({
        id: LABEL_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['case',['get','hasScore'],['to-string',['get','score']],''],
          'text-size': 11,
          'text-font': ['Arial', 'Helvetica', 'sans-serif'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 1,
        },
      });

      mapRef.current = m;
      describeCenter();
      setMapLoaded(true);
    });

    // Click handler — via queryRenderedFeatures, stable
    m.on('click', CIRCLE_LAYER, (e) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const iso = feature.properties?.iso as string;
      if (iso) {
        setSelectedIso(iso);
      }
    });

    // The geographic shapes are selectable only where the source directory's
    // point falls unambiguously inside one polygon. Unmatched shapes stay inert.
    m.on('click', 'map-land', (e) => {
      if (m.queryRenderedFeatures(e.point, { layers: [CIRCLE_LAYER] }).length) return;
      const iso = e.features?.[0]?.properties?.iso;
      if (typeof iso === 'string' && getDirectoryCountry(iso)) setSelectedIso(iso);
    });
    m.on('mousemove', 'map-land', (e) => {
      if (m.queryRenderedFeatures(e.point, { layers: [CIRCLE_LAYER] }).length) return;
      m.getCanvas().style.cursor = e.features?.[0]?.properties?.iso ? 'pointer' : '';
    });
    m.on('mouseleave', 'map-land', () => {
      m.getCanvas().style.cursor = '';
    });

    // Hover cursor
    m.on('mouseenter', CIRCLE_LAYER, () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', CIRCLE_LAYER, () => {
      m.getCanvas().style.cursor = '';
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    });

    // Hover popup
    m.on('mousemove', CIRCLE_LAYER, (e) => {
      if (!e.features || e.features.length === 0) return;
      const f = e.features[0];
      const props = f.properties!;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

      if (popupRef.current) popupRef.current.remove();
      // Map handlers are bound once; read the current language from <html lang>.
      const zh = document.documentElement.lang === 'zh-CN';

      const content=document.createElement('div');content.style.minWidth='160px';
      const title=document.createElement('div');title.style.fontWeight='600';title.textContent=`${props.flag} ${zh ? COUNTRY_ZH[props.iso] ?? props.name : props.name}`;
      const region=document.createElement('div');region.style.fontSize='11px';region.textContent=String(props.region);
      const value=document.createElement('div');value.style.marginTop='6px';value.textContent=props.hasScore ? `${zh?'估算分数':'Estimated score'}: ${props.score}/100` : (zh?'未收录政策评分':'No curated policy score');
      const source=document.createElement('div');source.style.marginTop='3px';source.textContent=props.hasSource ? (zh?'已配置官方来源位置':'Official source location configured') : (zh?'仅有地理目录':'Geographic directory only');
      content.append(title,region,value,source);
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 }).setLngLat(coords).setDOMContent(content).addTo(m);
    });

    return () => {
      if (popupRef.current) popupRef.current.remove();
      m.remove();
      mapRef.current = null;
    };
  }, []);

  // Update source data and paint when category changes
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !mapLoaded) return;

    const source = m.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }

    // Update circle color to match category
    m.setPaintProperty(CIRCLE_LAYER, 'circle-color', ['case',['get','hasScore'],catColor,['get','hasSource'],'#60A5FA','#9CA3AF']);
    m.setPaintProperty(CIRCLE_LAYER, 'circle-stroke-color', ['case',['get','hasScore'],catColor,['get','hasSource'],'#60A5FA','#9CA3AF']);
  }, [geojson, catColor, mapLoaded]);

  // Fly to selected country
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !selectedIso) return;
    const c = getDirectoryCountry(selectedIso);
    if (c && c.lat !== null && c.lon !== null) {
      m.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 800 });
    }
  }, [selectedIso, mapLoaded]);

  const selectedDirectory = selectedIso ? getDirectoryCountry(selectedIso) : null;
  const selectedCountry = selectedIso ? countries.find(c => c.iso === selectedIso) : null;
  const selectedMetrics = selectedIso ? getMetrics(selectedIso) : null;
  const selectedPolicies = selectedIso ? getPoliciesByCountry(selectedIso) : [];
  const selectedFreshness = selectedIso ? getCountryFreshness(selectedIso) : null;
  const selectedAnnouncementSources = selectedIso ? ANNOUNCEMENT_SOURCES.filter(source => source.countries.includes(selectedIso)) : [];
  const selectedPipelineSources = selectedIso ? PIPELINE_COVERAGE.filter(source => source.countryIso === selectedIso) : [];

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-surface border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted mr-2 hidden sm:inline">{t('Domain:', '领域：')}</span>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeCategory === cat.key
                  ? 'text-white'
                  : 'text-muted hover:text-foreground bg-surface-2'
              }`}
              style={activeCategory === cat.key ? { background: cat.color } : {}}
            >
              {t(cat.label, cat.zh)}
            </button>
          ))}
        </div>
        <div className="hidden md:flex items-center gap-4 text-xs text-muted">
          <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border">{t(`${countryDirectory.length} directory entries · ${configuredSourceCountries.size} with configured sources · ${countries.length} estimated-score profiles`,`${countryDirectory.length} 个地理目录条目 · ${configuredSourceCountries.size} 个配置来源 · ${countries.length} 个估算评分档案`)}</span>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-2 border-b border-border bg-surface flex flex-wrap gap-3 items-center">
        <div role="group" aria-label={t('Map coverage', '地图覆盖范围')} className="flex flex-wrap gap-1">
          {([
            ['all', t(`All geography (${countryDirectory.length})`, `全部地理目录（${countryDirectory.length}）`)],
            ['sources', t(`Configured sources (${configuredSourceCountries.size})`, `已配置来源（${configuredSourceCountries.size}）`)],
            ['scores', t(`Scored in this domain (${countryDirectory.filter(c => directoryScore(c.iso, activeCategory) !== null).length})`, `本领域有评分（${countryDirectory.filter(c => directoryScore(c.iso, activeCategory) !== null).length}）`)],
          ] as const).map(([filter, label]) => <button key={filter} type="button"
            aria-pressed={coverageFilter === filter}
            onClick={() => { setCoverageFilter(filter); setSelectedIso(null); }}
            className={`min-h-10 rounded-lg border px-2 py-1 text-xs ${coverageFilter === filter ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted'}`}>{label}</button>)}
        </div>
        <label className="text-xs text-muted">{t('Country / economy','国家／经济体')}<select aria-label={t('Select a country','选择国家')} disabled={!interactive} value={selectedIso||''} onChange={e=>setSelectedIso(e.target.value||null)} className="ml-2 min-h-11 max-w-full border border-border rounded-lg px-2 bg-background text-foreground"><option value="">{t('Choose from the current map layer','从当前地图图层选择')}</option>{visibleDirectory.map(c=><option key={c.iso} value={c.iso}>{countryFlag(c.iso)} {countryName(c.iso,c.name,locale)}</option>)}</select></label>
        <span className="text-xs text-muted">{t('211 mapped locations · 6 directory entries lack source coordinates','211 个地图位置 · 6 个目录条目缺少来源坐标')}</span>
        <a href={directorySource.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted underline underline-offset-2">{directorySource.attribution}</a>
      </div>
      {/* Map + panels */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0" style={{ position: 'absolute' }} />

        {/* Legend */}
        <div className="absolute top-4 right-14 bg-surface/95 backdrop-blur-sm border border-border rounded-lg p-3 text-xs space-y-2 hidden md:block">
          <div className="font-semibold text-foreground mb-1">{catLabel(activeCategory)}</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full opacity-25" style={{ background: catColor }} />
              <span className="text-muted">{t('Low (0)', '低 (0)')}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full opacity-60" style={{ background: catColor }} />
              <span className="text-muted">{t('Mid', '中')}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ background: catColor }} />
              <span className="text-muted">{t('High (100)', '高 (100)')}</span>
            </div>
          </div>
          <div className="text-[10px] text-muted/60 pt-1 border-t border-border/50">{t('Category color: estimated score · Blue: source location configured, no score · Gray: geography only', '领域颜色：估算评分 · 蓝色：已配置来源但无评分 · 灰色：仅地理目录')}</div>
        </div>

        {/* Rankings sidebar */}
        <div className="absolute bottom-4 left-4 w-64 max-h-72 overflow-y-auto bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl hidden lg:block">
          <div className="p-3 border-b border-border sticky top-0 bg-surface/95 backdrop-blur-xl rounded-t-xl z-10">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">{t('Country directory', '国家／经济体目录')}</span>
          </div>
          <input aria-label={t('Find country','查找国家')} value={countryQuery} onChange={e=>setCountryQuery(e.target.value)} placeholder={t('Search name or code','搜索名称或代码')} className="w-full border-y border-border px-3 py-2 text-xs bg-background" />
          <div className="divide-y divide-border/50">
            {[...visibleDirectory]
              .filter(c=>`${c.name} ${c.iso} ${countryName(c.iso,c.name,locale)}`.toLowerCase().includes(countryQuery.toLowerCase()))
              .sort((a,b)=>a.name.localeCompare(b.name))
              .map((c, i) => {
                const score = directoryScore(c.iso, activeCategory);
                const isSelected = selectedIso === c.iso;
                return (
                  <button
                    key={c.iso}
                    onClick={() => setSelectedIso(c.iso)}
                    className={`flex items-center gap-2.5 px-3 py-2 w-full text-left hover:bg-surface-2 transition-colors ${isSelected ? 'bg-surface-2' : ''}`}
                  >
                    <span className="text-[10px] text-muted w-4 text-right">{i + 1}</span>
                    <span className="text-sm">{countryFlag(c.iso)}</span>
                    <span className="text-xs font-medium flex-1 truncate">{countryName(c.iso, c.name, locale)}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: catColor }}>{score===null?'—':score}</span>
                  </button>
                );
              })}
          </div>
        </div>

        {selectedDirectory && !selectedMetrics && <div data-testid="directory-country-detail" className="absolute top-4 left-4 w-80 max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] overflow-y-auto bg-surface border border-border rounded-xl p-5 lg:left-72 lg:ml-4">
          <button onClick={()=>setSelectedIso(null)} className="float-right text-muted" aria-label={t('Close country details','关闭国家资料')}>×</button>
          <h2 className="font-semibold">{countryFlag(selectedDirectory.iso)} {countryName(selectedDirectory.iso,selectedDirectory.name,locale)}</h2>
          <p className="text-xs text-muted mt-2">{selectedDirectory.region} · {selectedDirectory.capital||t('Capital not supplied','未提供首都')}</p>
          <p className="text-sm mt-4">{t('This economy is available in the geographic directory. No curated policy score is recorded; missing data are not a zero score.','该国家／经济体已加入地理目录，目前未收录政策评分。缺失数据不代表零分。')}</p>
          <p className="text-xs text-muted mt-3">{selectedAnnouncementSources.length || selectedPipelineSources.length ? t(`Announcement sources: ${selectedAnnouncementSources.length} · policy source locations: ${selectedPipelineSources.length}. Configuration is not proof of a current read or policy in force.`,`公告来源：${selectedAnnouncementSources.length} 个 · 政策来源位置：${selectedPipelineSources.length} 个。配置不代表已读取或政策已生效。`) : t('No policy source is configured for this economy yet.','这个国家／经济体尚未配置政策来源。')}</p>
          <SourceReadCheck key={selectedDirectory.iso} countryIso={selectedDirectory.iso} connectorCount={selectedAnnouncementSources.length} />
          <CountryResearch key={`${selectedDirectory.iso}:${activeCategory}`} countryIso={selectedDirectory.iso} domain={activeCategory} />
          {(selectedDirectory.lat===null||selectedDirectory.lon===null)&&<p className="text-xs text-muted mt-2">{t('The source does not supply a map coordinate.','来源未提供地图坐标。')}</p>}
          <a href={directorySource.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent mt-3">{directorySource.attribution}</a>
          <a href={directorySource.datasetTermsUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-muted mt-1 underline">{t('Dataset terms', '数据集条款')}</a>
          <Link href={`/verify?country=${selectedDirectory.iso}`} className="block text-sm text-accent mt-4">{t('Verify a precise claim with live sources →','用实时来源核验具体声明 →')}</Link>
        </div>}

        {/* Selected country detail panel */}
        {selectedCountry && selectedMetrics && (
          <div className="absolute top-4 left-4 w-80 max-h-[calc(100%-8rem)] overflow-y-auto bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl lg:left-72 lg:ml-4">
            <div className="p-4 border-b border-border sticky top-0 bg-surface/95 backdrop-blur-xl rounded-t-xl z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{selectedCountry.flagEmoji}</span>
                  <div>
                    <div className="text-sm font-bold">{countryName(selectedCountry.iso, selectedCountry.name, locale)}</div>
                    <div className="text-[10px] text-muted">{zd.region(selectedCountry.region, '')} &middot; {zd.income(selectedCountry.incomeGroup, '')}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedIso(null)} className="text-muted hover:text-foreground text-lg leading-none">&times;</button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Quick stats */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-background border border-border/50">
                  <div className="text-muted">{t('Population', '人口')}</div>
                  <div className="font-semibold">{formatPopulation(selectedCountry.population)}</div>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border/50">
                  <div className="text-muted">GDP</div>
                  <div className="font-semibold">{formatGDP(selectedCountry.gdp)}</div>
                </div>
              </div>

              {/* Scores for all 3 categories */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted uppercase tracking-wider">{t('Policy Scores', '政策分数')}</div>
                {(['climate', 'trade', 'immigration'] as CategoryKey[]).map(cat => {
                  const score = getMetricScore(selectedCountry.iso, cat);
                  const color = getCategoryColor(cat);
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-xs text-muted flex-1">{catLabel(cat)}</span>
                      <div className="w-20 h-1.5 rounded-full bg-surface-2 flex-shrink-0">
                        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
                      </div>
                      <span className="text-xs font-bold w-6 text-right" style={{ color }}>{score===null?'—':score}</span>
                    </div>
                  );
                })}
              </div>

              {/* Data freshness */}
              {selectedFreshness && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">{t('How up to date', '数据是否最新')}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="p-1.5 rounded bg-background border border-border/50 text-center">
                      <div className="text-[10px] text-muted">{t('Verified', '已核实')}</div>
                      <div className="text-xs font-bold text-green-400">{selectedFreshness.recentlyVerified}</div>
                    </div>
                    <div className="p-1.5 rounded bg-background border border-border/50 text-center">
                      <div className="text-[10px] text-muted">{t('Stale', '过期')}</div>
                      <div className="text-xs font-bold text-orange-400">{selectedFreshness.stalePolicies}</div>
                    </div>
                    <div className="p-1.5 rounded bg-background border border-border/50 text-center">
                      <div className="text-[10px] text-muted">{t('Confidence', '可信度')}</div>
                      <div className={`text-xs font-bold ${selectedFreshness.overallConfidence === 'high' ? 'text-green-400' : selectedFreshness.overallConfidence === 'medium' ? 'text-yellow-400' : 'text-orange-400'}`}>{selectedFreshness.overallConfidence}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Top policies */}
              {selectedPolicies.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wider">{t('Key Policies', '主要政策')}</div>
                  {selectedPolicies.slice(0, 3).map(p => {
                    const fl = getFreshnessLabel(p.id);
                    const fc = FRESHNESS_CONFIG[fl];
                    return (
                      <div key={p.id} className="p-2 rounded-lg bg-background border border-border/50">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: getCategoryColor(p.category) }} />
                          <span className="text-[10px] font-medium truncate flex-1">{zd.policyTitle(p.id, p.title)}</span>
                          <span className="text-[9px] px-1 py-0.5 rounded border flex-shrink-0" style={{ color: fc.color, borderColor: fc.color + '40', background: fc.color + '15' }}>
                            {fc.icon} {fc.text}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted line-clamp-1">{zd.policyDesc(p.id, p.description)}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Link to full page */}
              <SourceReadCheck key={selectedCountry.iso} countryIso={selectedCountry.iso} connectorCount={selectedAnnouncementSources.length} />
              <CountryResearch key={`${selectedCountry.iso}:${activeCategory}`} countryIso={selectedCountry.iso} domain={activeCategory} />
              <Link
                href={`/countries/${selectedCountry.iso.toLowerCase()}`}
                className="block text-center py-2 rounded-full bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
              >
                {t('View full country profile →', '查看完整国家档案 →')}
              </Link>
              <Link href={`/intelligence?country=${selectedCountry.iso}`} className="block text-center text-xs text-accent py-2">{t('Read official sources →', '查看官方来源 →')}</Link>
              <Link href={`/verify?country=${selectedCountry.iso}`} className="block text-center text-xs text-accent py-2">{t('Verify a precise claim →', '核验具体政策声明 →')}</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
