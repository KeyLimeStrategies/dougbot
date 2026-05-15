'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, BarChart3, Search, Calendar } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { AdPerformance as AdPerf, ClientGroup } from '@/lib/types';

interface Summary {
  total_ads: number;
  paused_ads?: number;
  total_clients: number;
  scale_count: number;
  drop_count: number;
  kill_count: number;
  hold_count: number;
  total_wasted_spend: number;
}

const recStyles: Record<string, { bg: string; text: string; border: string }> = {
  SCALE: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-700' },
  DROP: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-700' },
  KILL: { bg: 'bg-orange-900/30', text: 'text-orange-400', border: 'border-orange-700' },
  HOLD: { bg: 'bg-gray-800/50', text: 'text-gray-500', border: 'border-gray-700' },
};

export default function AdPerformance({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ ads: AdPerf[]; clients: ClientGroup[]; summary: Summary }>({
    ads: [], clients: [], summary: { total_ads: 0, total_clients: 0, scale_count: 0, drop_count: 0, kill_count: 0, hold_count: 0, total_wasted_spend: 0 },
  });
  const [clientFilter, setClientFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [checkedAds, setCheckedAds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'clients' | 'kill'>('clients');
  const [hidePaused, setHidePaused] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (clientFilter) params.set('client', clientFilter);
    fetch(`/api/ad-performance?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, [clientFilter, refreshKey]);

  const allClients = [...new Set(data.ads.map(a => a.short_code))].sort();
  const activeAds = hidePaused ? data.ads.filter(a => a.ad_delivery === 'active' || a.ad_delivery === '') : data.ads;

  // Search filtering
  const searchLower = searchQuery.toLowerCase().trim();
  const filteredAds = searchLower
    ? activeAds.filter(a => a.ad_name.toLowerCase().includes(searchLower))
    : activeAds;

  // Filter client groups based on search
  const filteredClients = useMemo(() => {
    if (!searchLower) return data.clients;
    return data.clients.filter(c => {
      const adSet = new Set(c.ads);
      return filteredAds.some(a => adSet.has(a.ad_name));
    });
  }, [data.clients, filteredAds, searchLower]);

  const killAds = activeAds.filter(a => a.recommendation === 'KILL');
  const dropAds = activeAds.filter(a => a.recommendation === 'DROP');

  const toggleExpand = (shortCode: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(shortCode)) next.delete(shortCode);
      else next.add(shortCode);
      return next;
    });
  };

  const toggleCheck = (adName: string) => {
    setCheckedAds(prev => {
      const next = new Set(prev);
      if (next.has(adName)) next.delete(adName);
      else next.add(adName);
      return next;
    });
  };

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  // Auto-expand all clients when searching
  const isSearchActive = searchLower.length > 0;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Active Ads', count: data.summary.total_ads, color: 'text-white' },
          { label: 'SCALE', count: data.summary.scale_count, color: 'text-green-400' },
          { label: 'DROP', count: data.summary.drop_count, color: 'text-red-400' },
          { label: 'KILL', count: data.summary.kill_count, color: 'text-orange-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
            <div className={`text-2xl font-bold ${color}`}>{count}</div>
            <div className="text-xs text-gray-500 uppercase">{label}</div>
          </div>
        ))}
      </div>

      {data.summary.total_wasted_spend > 0 && (
        <div className="bg-orange-900/20 border border-orange-800/50 rounded-lg p-3 mb-4 text-sm text-orange-300">
          Wasted spend (KILL ads, $0 ActBlue revenue): <span className="font-bold">{fmt(data.summary.total_wasted_spend)}</span>
        </div>
      )}

      {/* Controls row */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search ads..."
            className="bg-gray-800 text-gray-300 text-sm rounded pl-8 pr-3 py-1.5 border border-gray-700 focus:border-lime-500 focus:outline-none w-48"
          />
        </div>

        {/* Client filter */}
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="bg-gray-800 text-gray-300 text-sm rounded px-3 py-1.5 border border-gray-700"
        >
          <option value="">All Clients</option>
          {allClients.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <button
          onClick={() => setHidePaused(!hidePaused)}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${
            hidePaused
              ? 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              : 'bg-purple-900/30 border-purple-700 text-purple-300'
          }`}
        >
          {hidePaused ? 'Paused Hidden' : 'Showing Paused'}
          {(data.summary.paused_ads ?? 0) > 0 && <span className="text-gray-500">({data.summary.paused_ads})</span>}
        </button>

        {/* Tab toggle */}
        <div className="flex ml-auto bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <button
            onClick={() => setActiveTab('clients')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'clients' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Clients
          </button>
          <button
            onClick={() => setActiveTab('kill')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'kill' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Kill/Drop {(killAds.length + dropAds.length) > 0 && <span className="ml-1 text-orange-400">({killAds.length + dropAds.length})</span>}
          </button>
        </div>
      </div>

      {/* CLIENTS TAB */}
      {activeTab === 'clients' && (
        <div className="space-y-2">
          {filteredClients.map(client => (
            <ClientCard
              key={client.short_code}
              client={client}
              ads={filteredAds}
              expanded={isSearchActive || expandedClients.has(client.short_code)}
              onToggle={() => toggleExpand(client.short_code)}
              fmt={fmt}
              hidePaused={hidePaused}
              searchQuery={searchLower}
            />
          ))}
          {filteredClients.length === 0 && (
            <div className="text-gray-500 text-center py-12">
              {searchLower ? 'No ads match your search.' : 'No ad data. Sync data to see results.'}
            </div>
          )}
        </div>
      )}

      {/* KILL/DROP TAB */}
      {activeTab === 'kill' && (
        <div>
          {(killAds.length + dropAds.length) > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="w-8 py-2 px-2"></th>
                    <th className="text-left py-2 px-2">Ad Name</th>
                    <th className="text-left py-2 px-2">Client</th>
                    <th className="text-right py-2 px-2">Spend</th>
                    <th className="text-right py-2 px-2">AB Rev</th>
                    <th className="text-right py-2 px-2">ROI</th>
                    <th className="text-right py-2 px-2">Conv</th>
                    <th className="text-right py-2 px-2">CPP</th>
                    <th className="text-right py-2 px-2">Freq</th>
                    <th className="text-left py-2 px-2">Rec</th>
                    <th className="text-left py-2 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {[...killAds, ...dropAds].map(ad => (
                    <tr
                      key={ad.ad_name}
                      className={`border-b border-gray-800/50 ${ad.recommendation === 'KILL' ? 'bg-orange-900/10' : 'bg-red-900/10'} ${checkedAds.has(ad.ad_name) ? 'opacity-40 line-through' : ''}`}
                    >
                      <td className="py-1.5 px-2">
                        <input
                          type="checkbox"
                          checked={checkedAds.has(ad.ad_name)}
                          onChange={() => toggleCheck(ad.ad_name)}
                          className="rounded border-gray-600"
                        />
                      </td>
                      <td className="py-1.5 px-2 text-white font-mono text-xs">{ad.ad_name}</td>
                      <td className="py-1.5 px-2 text-gray-400">{ad.client_name}</td>
                      <td className="py-1.5 px-2 text-right text-gray-300">{fmt(ad.total_spend)}</td>
                      <td className={`py-1.5 px-2 text-right ${ad.actblue_revenue > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                        {ad.actblue_revenue > 0 ? fmt(ad.actblue_revenue) : '$0'}
                      </td>
                      <td className={`py-1.5 px-2 text-right font-mono ${ad.roi >= 1.0 ? 'text-green-400' : ad.roi > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                        {ad.roi > 0 ? `${ad.roi.toFixed(2)}x` : '-'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-300">{ad.total_results}</td>
                      <td className={`py-1.5 px-2 text-right font-mono ${ad.cpp > 40 ? 'text-red-400' : 'text-gray-300'}`}>
                        {ad.cpp > 0 ? fmt(ad.cpp) : '-'}
                      </td>
                      <td className={`py-1.5 px-2 text-right ${ad.frequency > 2.0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {ad.frequency.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2">
                        <RecBadge rec={ad.recommendation} />
                      </td>
                      <td className="py-1.5 px-2 text-xs text-gray-500">{ad.rec_reason || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-12">No ads flagged for kill or drop.</div>
          )}
        </div>
      )}
    </div>
  );
}

function RecBadge({ rec }: { rec: string }) {
  if (rec === 'HOLD') return null;
  const style = recStyles[rec] || recStyles.HOLD;
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded border ${style.bg} ${style.text} ${style.border}`}>
      {rec === 'KILL' && <AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" />}
      {rec}
    </span>
  );
}

function ClientCard({
  client,
  ads,
  expanded,
  onToggle,
  fmt,
  hidePaused,
  searchQuery,
}: {
  client: ClientGroup;
  ads: AdPerf[];
  expanded: boolean;
  onToggle: () => void;
  fmt: (n: number) => string;
  hidePaused: boolean;
  searchQuery: string;
}) {
  return (
    <div className="border rounded-lg border-gray-700 bg-gray-800/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0 shrink">
          <div className="min-w-0">
            <span className="text-white font-medium truncate block">{client.client_name}</span>
            <span className="text-gray-600 text-xs">{client.ad_count} ads</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h ROI</div>
            <div className={`font-mono font-medium ${client.roi_72h >= 1.3 ? 'text-green-400' : client.roi_72h < 1 && client.roi_72h > 0 ? 'text-red-400' : 'text-gray-300'}`}>
              {client.roi_72h > 0 ? `${client.roi_72h.toFixed(2)}x` : '-'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h Spend</div>
            <div className="text-gray-300 font-mono">{fmt(client.spend_72h)}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h Rev</div>
            <div className="text-gray-300 font-mono">{fmt(client.revenue_72h)}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h CPP</div>
            <div className={`font-mono ${client.cpp_72h > 0 && client.avg_cpp_portfolio > 0 && client.cpp_72h < client.avg_cpp_portfolio ? 'text-green-400' : client.cpp_72h > client.avg_cpp_portfolio * 1.5 ? 'text-red-400' : 'text-gray-300'}`}>
              {client.cpp_72h > 0 ? fmt(client.cpp_72h) : '-'}
            </div>
          </div>
          {expanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        </div>
      </button>
      {expanded && <ClientAdsTable ads={ads} client={client} fmt={fmt} hidePaused={hidePaused} searchQuery={searchQuery} />}
    </div>
  );
}

function AdChart({ adName }: { adName: string }) {
  const [data, setData] = useState<{ date: string; spend: number; revenue: number; roi: number; results: number }[]>([]);
  const [video, setVideo] = useState<{ has_data: boolean; hook_rate: number; retention_rate: number; impressions: number; hook_views: number; completions: number } | null>(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/ad-revenue?ad_name=${encodeURIComponent(adName)}&days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d.daily || []); setVideo(d.video || null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [adName, days]);

  if (loading) return <div className="text-gray-500 text-xs py-2 pl-4">Loading chart...</div>;
  if (data.length === 0) return <div className="text-gray-600 text-xs py-2 pl-4">No daily data available</div>;

  return (
    <div className="px-4 py-2 bg-gray-900/50">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase">Daily ROI</span>
        {[7, 14, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2 py-0.5 text-[10px] rounded ${days === d ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
          >
            {d}d
          </button>
        ))}
        {video?.has_data && (
          <div className="ml-auto flex items-center gap-3 text-[10px]">
            <span className="text-gray-500 uppercase">Video ({days}d):</span>
            <span className="text-gray-400" title="2-sec continuous views / impressions">
              Hook Rate: <span className={`font-mono font-semibold ${video.hook_rate >= 0.25 ? 'text-green-400' : video.hook_rate >= 0.15 ? 'text-yellow-400' : 'text-red-400'}`}>
                {(video.hook_rate * 100).toFixed(1)}%
              </span>
            </span>
            <span className="text-gray-400" title="100% completions / 2-sec views">
              Retention: <span className={`font-mono font-semibold ${video.retention_rate >= 0.15 ? 'text-green-400' : video.retention_rate >= 0.08 ? 'text-yellow-400' : 'text-red-400'}`}>
                {(video.retention_rate * 100).toFixed(1)}%
              </span>
            </span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" stroke="#4b5563" tick={{ fontSize: 9 }}
            tickFormatter={(d: string) => { const [,m,day] = d.split('-'); return `${parseInt(m)}/${parseInt(day)}`; }} />
          <YAxis stroke="#4b5563" tick={{ fontSize: 9 }} domain={[0, 'auto']}
            tickFormatter={(v: number) => `${v.toFixed(1)}x`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #374151', borderRadius: '6px', fontSize: '11px' }}
            labelFormatter={(d) => new Date(String(d) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            formatter={(v) => [`${Number(v || 0).toFixed(2)}x`, 'ROI']}
          />
          <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
          <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} />
          <Line type="monotone" dataKey="roi" stroke="#84cc16" strokeWidth={2} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type Period = 'all' | '1d' | '3d' | '7d' | '14d' | 'custom';

function ClientAdsTable({ ads, client, fmt, hidePaused, searchQuery }: {
  ads: AdPerf[];
  client: ClientGroup;
  fmt: (n: number) => string;
  hidePaused: boolean;
  searchQuery: string;
}) {
  const [expandedAd, setExpandedAd] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('3d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customData, setCustomData] = useState<AdPerf[] | null>(null);

  const adSet = new Set(client.ads);
  let campaignAds = ads.filter(a => adSet.has(a.ad_name));
  if (searchQuery) {
    campaignAds = campaignAds.filter(a => a.ad_name.toLowerCase().includes(searchQuery));
  }
  if (hidePaused) {
    campaignAds = campaignAds.filter(a => a.ad_delivery === 'active' || a.ad_delivery === '');
  }
  campaignAds = campaignAds.sort((a, b) => {
    const spendA = getAdSpend(a, period, customData);
    const spendB = getAdSpend(b, period, customData);
    return spendB - spendA;
  });

  // Fetch custom date data when applied
  const handleApplyCustom = () => {
    if (!customStart || !customEnd) return;
    setPeriod('custom');
    fetch(`/api/ad-performance?date_start=${customStart}&date_end=${customEnd}${client.short_code ? `&client=${client.short_code}` : ''}`)
      .then(r => r.json())
      .then(d => setCustomData(d.ads || []))
      .catch(console.error);
  };

  return (
    <div className="border-t border-gray-800/50 px-4 py-2">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase">Period</span>
        {(['1d', '3d', '7d', '14d', 'all'] as const).map(p => (
          <button
            key={p}
            onClick={() => { setPeriod(p); setShowDatePicker(false); }}
            className={`px-2 py-0.5 text-[10px] rounded ${period === p ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
          >
            {p === 'all' ? 'All' : p.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className={`px-1.5 py-0.5 text-[10px] rounded ${period === 'custom' || showDatePicker ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
          title="Custom date range"
        >
          <Calendar size={10} />
        </button>
      </div>

      {showDatePicker && (
        <div className="flex items-center gap-2 mb-2 bg-gray-900 rounded px-3 py-2">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[11px] text-white focus:border-lime-500 focus:outline-none" />
          <span className="text-gray-500 text-[10px]">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[11px] text-white focus:border-lime-500 focus:outline-none" />
          <button onClick={handleApplyCustom} disabled={!customStart || !customEnd}
            className="px-2 py-0.5 text-[10px] rounded bg-lime-600 text-white hover:bg-lime-500 disabled:opacity-40">
            Apply
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-600 uppercase">
              <th className="w-5 py-1 px-1"></th>
              <th className="text-left py-1 px-1">Ad</th>
              <th className="text-right py-1 px-1">Spend{period !== 'all' ? ` (${period})` : ''}</th>
              <th className="text-right py-1 px-1">AB Rev{period !== 'all' ? ` (${period})` : ''}</th>
              <th className="text-right py-1 px-1">ROI{period !== 'all' ? ` (${period})` : ''}</th>
              <th className="text-right py-1 px-1">Conv{period !== 'all' ? ` (${period})` : ''}</th>
              <th className="text-right py-1 px-1">Clicks{period !== 'all' ? ` (${period})` : ''}</th>
              <th className="text-right py-1 px-1">Conv%</th>
              <th className="text-right py-1 px-1">CPP</th>
              <th className="text-right py-1 px-1">Freq</th>
              <th className="text-center py-1 px-1">24h</th>
              <th className="text-left py-1 px-1">Launched</th>
              <th className="text-left py-1 px-1">Rec</th>
            </tr>
          </thead>
          <tbody>
            {campaignAds.map(ad => (
              <AdRow key={ad.ad_name} ad={ad} fmt={fmt} period={period} customData={customData}
                expanded={expandedAd === ad.ad_name}
                onToggle={() => setExpandedAd(expandedAd === ad.ad_name ? null : ad.ad_name)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getAdSpend(ad: AdPerf, period: Period, customData: AdPerf[] | null): number {
  if (period === 'custom' && customData) {
    const cAd = customData.find(a => a.ad_name === ad.ad_name);
    return cAd?.spend_custom ?? 0;
  }
  if (period === '1d') return ad.spend_1d;
  if (period === '3d') return ad.spend_3d;
  if (period === '7d') return ad.spend_7d;
  if (period === '14d') return ad.spend_14d;
  return ad.total_spend;
}

function getAdVal(ad: AdPerf, period: Period, customData: AdPerf[] | null, field: 'spend' | 'results' | 'link_clicks' | 'actblue_revenue' | 'roi'): number {
  if (period === 'custom' && customData) {
    const cAd = customData.find(a => a.ad_name === ad.ad_name);
    if (!cAd) return 0;
    return (cAd as any)[`${field}_custom`] ?? 0;
  }
  const suffix = period === '1d' ? '_1d' : period === '3d' ? '_3d' : period === '7d' ? '_7d' : period === '14d' ? '_14d' : '';
  if (!suffix) {
    if (field === 'spend') return ad.total_spend;
    if (field === 'results') return ad.total_results;
    if (field === 'link_clicks') return ad.link_clicks;
    if (field === 'actblue_revenue') return ad.actblue_revenue;
    if (field === 'roi') return ad.roi;
  }
  return (ad as any)[`${field}${suffix}`] ?? 0;
}

function AdRow({ ad, fmt, period, customData, expanded, onToggle }: {
  ad: AdPerf;
  fmt: (n: number) => string;
  period: Period;
  customData: AdPerf[] | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const spend = getAdVal(ad, period, customData, 'spend');
  const results = getAdVal(ad, period, customData, 'results');
  const clicks = getAdVal(ad, period, customData, 'link_clicks');
  const revenue = getAdVal(ad, period, customData, 'actblue_revenue');
  const roi = getAdVal(ad, period, customData, 'roi');
  const convRate = clicks > 0 ? (results / clicks) * 100 : 0;
  const cpp = results > 0 ? spend / results : 0;

  const isKillOrDrop = ad.recommendation === 'KILL' || ad.recommendation === 'DROP';

  return (
    <>
      <tr className={`border-t border-gray-800/30 ${isKillOrDrop ? 'text-red-400/80' : ''} cursor-pointer hover:bg-gray-800/30`} onClick={onToggle}>
        <td className="py-1 px-1 text-gray-500">
          <BarChart3 size={10} className={expanded ? 'text-lime-400' : ''} />
        </td>
        <td className="py-1 px-1 text-gray-300 font-mono">{ad.ad_name}</td>
        <td className="py-1 px-1 text-right text-gray-300">{fmt(spend)}</td>
        <td className={`py-1 px-1 text-right font-mono ${revenue > 0 ? 'text-green-400' : 'text-gray-600'}`}>
          {revenue > 0 ? fmt(revenue) : '$0'}
        </td>
        <td className={`py-1 px-1 text-right font-mono font-medium ${roi >= 1.3 ? 'text-green-400' : roi > 0 && roi < 1.0 ? 'text-red-400' : roi >= 1.0 ? 'text-yellow-400' : 'text-gray-600'}`}>
          {roi > 0 ? `${roi.toFixed(2)}x` : '-'}
        </td>
        <td className="py-1 px-1 text-right text-gray-300">{results}</td>
        <td className="py-1 px-1 text-right text-gray-400">{clicks}</td>
        <td className={`py-1 px-1 text-right font-mono ${convRate > 5 ? 'text-green-400' : convRate > 2 ? 'text-yellow-400' : convRate > 0 ? 'text-gray-300' : 'text-gray-600'}`}>
          {convRate > 0 ? `${convRate.toFixed(1)}%` : '-'}
        </td>
        <td className={`py-1 px-1 text-right font-mono ${cpp > 40 ? 'text-red-400' : cpp < 25 && cpp > 0 ? 'text-green-400' : 'text-gray-300'}`}>
          {cpp > 0 ? fmt(cpp) : '-'}
        </td>
        <td className={`py-1 px-1 text-right ${ad.frequency > 2.0 ? 'text-red-400' : 'text-gray-400'}`}>
          {ad.frequency.toFixed(2)}
        </td>
        <td className="py-1 px-1 text-center">
          {ad.trend === 'up' && <ArrowUp size={14} className="text-green-400 inline" />}
          {ad.trend === 'down' && <ArrowDown size={14} className="text-red-400 inline" />}
          {ad.trend === 'flat' && <Minus size={12} className="text-gray-600 inline" />}
          {ad.trend === 'new' && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">NEW</span>
          )}
        </td>
        <td className="py-1 px-1 text-gray-500 whitespace-nowrap">
          {ad.first_seen ? new Date(ad.first_seen + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
        </td>
        <td className="py-1 px-1">
          <RecBadge rec={ad.recommendation} />
        </td>
      </tr>
      {expanded && (
        <tr><td colSpan={13}><AdChart adName={ad.ad_name} /></td></tr>
      )}
    </>
  );
}
