'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, BarChart3 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { AdPerformance as AdPerf, CampaignPerformance } from '@/lib/types';

interface Summary {
  total_ads: number;
  paused_ads?: number;
  total_campaigns: number;
  kill_count: number;
  scale_count: number;
  drop_count: number;
  hold_count: number;
  total_wasted_spend: number;
}

const campaignRecStyles: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
  SCALE: { icon: <TrendingUp size={16} className="text-green-400" />, bg: 'bg-green-900/20 border-green-800/50', text: 'text-green-400' },
  DROP: { icon: <TrendingDown size={16} className="text-red-400" />, bg: 'bg-red-900/20 border-red-800/50', text: 'text-red-400' },
  HOLD: { icon: <Minus size={16} className="text-gray-500" />, bg: 'bg-gray-800/50 border-gray-700', text: 'text-gray-400' },
};

export default function AdPerformance({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ ads: AdPerf[]; campaigns: CampaignPerformance[]; summary: Summary }>({
    ads: [], campaigns: [], summary: { total_ads: 0, total_campaigns: 0, kill_count: 0, scale_count: 0, drop_count: 0, hold_count: 0, total_wasted_spend: 0 },
  });
  const [clientFilter, setClientFilter] = useState('');
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [checkedAds, setCheckedAds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'campaigns' | 'kill'>('campaigns');
  const [showHold, setShowHold] = useState(false);
  const [hidePaused, setHidePaused] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (clientFilter) params.set('client', clientFilter);
    fetch(`/api/ad-performance?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, [clientFilter, refreshKey]);

  const clients = [...new Set(data.ads.map(a => a.short_code))].sort();
  const activeAds = hidePaused ? data.ads.filter(a => a.ad_delivery === 'active' || a.ad_delivery === '') : data.ads;
  const killAds = activeAds.filter(a => a.recommendation === 'KILL');
  const scaleCampaigns = data.campaigns.filter(c => c.recommendation === 'SCALE');
  const dropCampaigns = data.campaigns.filter(c => c.recommendation === 'DROP');
  const holdCampaigns = data.campaigns.filter(c => c.recommendation === 'HOLD');

  const toggleExpand = (campaign: string) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(campaign)) next.delete(campaign);
      else next.add(campaign);
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

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Campaigns', count: data.summary.total_campaigns, color: 'text-white' },
          { label: 'SCALE', count: data.summary.scale_count, color: 'text-green-400' },
          { label: 'DROP', count: data.summary.drop_count, color: 'text-red-400' },
          { label: 'KILL Ads', count: data.summary.kill_count, color: 'text-orange-400' },
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

      {/* Client filter */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="bg-gray-800 text-gray-300 text-sm rounded px-3 py-1.5 border border-gray-700"
        >
          <option value="">All Clients</option>
          {clients.map(c => (
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
          title={hidePaused ? 'Paused ads are hidden' : 'Showing paused ads'}
        >
          {hidePaused ? 'Paused Hidden' : 'Showing Paused'}
          {(data.summary.paused_ads ?? 0) > 0 && <span className="text-gray-500">({data.summary.paused_ads})</span>}
        </button>

        {/* Tab toggle */}
        <div className="flex ml-auto bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <button
            onClick={() => setActiveTab('campaigns')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'campaigns' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Campaigns
          </button>
          <button
            onClick={() => setActiveTab('kill')}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'kill' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Kill List {killAds.length > 0 && <span className="ml-1 text-orange-400">({killAds.length})</span>}
          </button>
        </div>
      </div>

      {/* CAMPAIGNS TAB */}
      {activeTab === 'campaigns' && (
        <div className="space-y-6">
          {/* SCALE campaigns */}
          {scaleCampaigns.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-green-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <TrendingUp size={14} /> Scale ({scaleCampaigns.length})
              </h3>
              <div className="space-y-2">
                {scaleCampaigns.map(c => (
                  <CampaignCard key={c.campaign} campaign={c} ads={activeAds} expanded={expandedCampaigns.has(c.campaign)} onToggle={() => toggleExpand(c.campaign)} fmt={fmt} hidePaused={hidePaused} />
                ))}
              </div>
            </div>
          )}

          {/* DROP campaigns */}
          {dropCampaigns.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <TrendingDown size={14} /> Drop ({dropCampaigns.length})
              </h3>
              <div className="space-y-2">
                {dropCampaigns.map(c => (
                  <CampaignCard key={c.campaign} campaign={c} ads={activeAds} expanded={expandedCampaigns.has(c.campaign)} onToggle={() => toggleExpand(c.campaign)} fmt={fmt} hidePaused={hidePaused} />
                ))}
              </div>
            </div>
          )}

          {/* HOLD campaigns (collapsed by default) */}
          {holdCampaigns.length > 0 && (
            <div>
              <button
                onClick={() => setShowHold(!showHold)}
                className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2 hover:text-gray-300 transition-colors"
              >
                {showHold ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Minus size={14} /> Hold ({holdCampaigns.length})
              </button>
              {showHold && (
                <div className="space-y-2">
                  {holdCampaigns.map(c => (
                    <CampaignCard key={c.campaign} campaign={c} ads={activeAds} expanded={expandedCampaigns.has(c.campaign)} onToggle={() => toggleExpand(c.campaign)} fmt={fmt} hidePaused={hidePaused} />
                  ))}
                </div>
              )}
            </div>
          )}

          {data.campaigns.length === 0 && (
            <div className="text-gray-500 text-center py-12">No campaign data. Sync data to see recommendations.</div>
          )}
        </div>
      )}

      {/* KILL TAB */}
      {activeTab === 'kill' && (
        <div>
          {killAds.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="w-8 py-2 px-2"></th>
                    <th className="text-left py-2 px-2">Ad Name</th>
                    <th className="text-left py-2 px-2">Client</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-right py-2 px-2">Spend</th>
                    <th className="text-right py-2 px-2">AB Rev</th>
                    <th className="text-right py-2 px-2">Results</th>
                    <th className="text-right py-2 px-2">CPP</th>
                    <th className="text-right py-2 px-2">Freq</th>
                    <th className="text-left py-2 px-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {killAds.map(ad => (
                    <tr
                      key={ad.ad_name}
                      className={`border-b border-gray-800/50 bg-red-900/10 ${checkedAds.has(ad.ad_name) ? 'opacity-40 line-through' : ''}`}
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
                      <td className="py-1.5 px-2 text-gray-500">{ad.campaign_type}</td>
                      <td className="py-1.5 px-2 text-right text-gray-300">{fmt(ad.total_spend)}</td>
                      <td className={`py-1.5 px-2 text-right ${ad.actblue_revenue > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                        {ad.actblue_revenue > 0 ? fmt(ad.actblue_revenue) : '$0'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-300">{ad.total_results}</td>
                      <td className={`py-1.5 px-2 text-right font-mono ${ad.cpp > 40 ? 'text-red-400' : 'text-gray-300'}`}>
                        {ad.cpp > 0 ? fmt(ad.cpp) : '-'}
                      </td>
                      <td className={`py-1.5 px-2 text-right ${ad.frequency > 2.0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {ad.frequency.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-xs text-gray-500">{ad.kill_reason || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-12">No ads flagged for kill.</div>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  ads,
  expanded,
  onToggle,
  fmt,
  hidePaused,
}: {
  campaign: CampaignPerformance;
  ads: AdPerf[];
  expanded: boolean;
  onToggle: () => void;
  fmt: (n: number) => string;
  hidePaused: boolean;
}) {
  const style = campaignRecStyles[campaign.recommendation];

  return (
    <div className={`border rounded-lg ${style.bg}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0 shrink">
          {style.icon}
          <div className="min-w-0">
            <span className="text-white font-medium truncate block">{campaign.campaign}</span>
            <span className="text-gray-600 text-xs">{campaign.ad_count} ads</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h ROI</div>
            <div className={`font-mono font-medium ${campaign.roi_72h >= 1.3 ? 'text-green-400' : campaign.roi_72h < 1 && campaign.roi_72h > 0 ? 'text-red-400' : 'text-gray-300'}`}>
              {campaign.roi_72h > 0 ? `${campaign.roi_72h.toFixed(2)}x` : '-'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h Spend</div>
            <div className="text-gray-300 font-mono">{fmt(campaign.spend_72h)}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h Rev</div>
            <div className="text-gray-300 font-mono">{fmt(campaign.revenue_72h)}</div>
          </div>
          <div className="text-right">
            <div className="text-gray-500 text-xs">72h CPP</div>
            <div className={`font-mono ${campaign.cpp_72h > 0 && campaign.avg_cpp_portfolio > 0 && campaign.cpp_72h < campaign.avg_cpp_portfolio ? 'text-green-400' : campaign.cpp_72h > campaign.avg_cpp_portfolio * 1.5 ? 'text-red-400' : 'text-gray-300'}`}>
              {campaign.cpp_72h > 0 ? fmt(campaign.cpp_72h) : '-'}
            </div>
          </div>
          <div className={`text-xs font-medium ${style.text} min-w-[60px] text-right`}>
            {campaign.recommendation}
          </div>
          {expanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        </div>
      </button>

      {/* Reason */}
      {campaign.reason && (
        <div className="px-4 pb-2 -mt-1">
          <span className={`text-xs ${style.text}`}>{campaign.reason}</span>
        </div>
      )}

      {/* Expanded: show individual ads */}
      {expanded && <CampaignAdsTable ads={ads} campaign={campaign} fmt={fmt} hidePaused={hidePaused} />}
    </div>
  );
}

function AdChart({ adName }: { adName: string }) {
  const [data, setData] = useState<{ date: string; spend: number; revenue: number; roi: number; results: number }[]>([]);
  const [video, setVideo] = useState<{ has_data: boolean; hook_rate: number; retention_rate: number; impressions: number; views_3s: number; thruplays: number } | null>(null);
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
            <span className="text-gray-400" title="3-sec plays / impressions. Higher = more people stopped scrolling.">
              Hook Rate: <span className={`font-mono font-semibold ${video.hook_rate >= 0.25 ? 'text-green-400' : video.hook_rate >= 0.15 ? 'text-yellow-400' : 'text-red-400'}`}>
                {(video.hook_rate * 100).toFixed(1)}%
              </span>
            </span>
            <span className="text-gray-400" title="Thruplays / 3-sec plays. Higher = more viewers finished the ad.">
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

function CampaignAdsTable({ ads, campaign, fmt, hidePaused }: { ads: AdPerf[]; campaign: CampaignPerformance; fmt: (n: number) => string; hidePaused: boolean }) {
  const [expandedAd, setExpandedAd] = useState<string | null>(null);
  const [period, setPeriod] = useState<'all' | '3d' | '7d' | '14d'>('all');

  const adSet = new Set(campaign.ads);
  const allCampaignAds = ads.filter(a => adSet.has(a.ad_name));
  const campaignAds = (hidePaused
    ? allCampaignAds.filter(a => a.ad_delivery === 'active' || a.ad_delivery === '')
    : allCampaignAds
  ).sort((a, b) => {
    const spendA = period === '3d' ? a.spend_3d : period === '7d' ? (a as any).spend_7d : period === '14d' ? (a as any).spend_14d : a.total_spend;
    const spendB = period === '3d' ? b.spend_3d : period === '7d' ? (b as any).spend_7d : period === '14d' ? (b as any).spend_14d : b.total_spend;
    return (spendB ?? 0) - (spendA ?? 0);
  });

  const getSpend = (ad: AdPerf) => {
    if (period === '3d') return ad.spend_3d;
    if (period === '7d') return (ad as any).spend_7d ?? 0;
    if (period === '14d') return (ad as any).spend_14d ?? 0;
    return ad.total_spend;
  };
  const getResults = (ad: AdPerf) => {
    if (period === '3d') return ad.results_3d;
    if (period === '7d') return (ad as any).results_7d ?? 0;
    if (period === '14d') return (ad as any).results_14d ?? 0;
    return ad.total_results;
  };

  return (
    <div className="border-t border-gray-800/50 px-4 py-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-gray-500 uppercase">Period</span>
        {(['3d', '7d', '14d', 'all'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-2 py-0.5 text-[10px] rounded ${period === p ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
          >
            {p === 'all' ? 'All' : p.toUpperCase()}
          </button>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-600 uppercase">
            <th className="w-5 py-1 px-1"></th>
            <th className="text-left py-1 px-1">Ad</th>
            <th className="text-right py-1 px-1">Spend{period !== 'all' ? ` (${period})` : ''}</th>
            <th className="text-right py-1 px-1">AB Rev</th>
            <th className="text-right py-1 px-1">ROI</th>
            <th className="text-right py-1 px-1"># Contributions{period !== 'all' ? ` (${period})` : ''}</th>
            <th className="text-right py-1 px-1">CPP</th>
            <th className="text-right py-1 px-1">Freq</th>
            <th className="text-center py-1 px-1">24h</th>
            <th className="text-left py-1 px-1">Launched</th>
            <th className="text-left py-1 px-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {campaignAds.map(ad => (
            <AdRow key={ad.ad_name} ad={ad} fmt={fmt} expanded={expandedAd === ad.ad_name}
              onToggle={() => setExpandedAd(expandedAd === ad.ad_name ? null : ad.ad_name)}
              periodSpend={getSpend(ad)} periodResults={getResults(ad)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdRow({ ad, fmt, expanded, onToggle, periodSpend, periodResults }: { ad: AdPerf; fmt: (n: number) => string; expanded: boolean; onToggle: () => void; periodSpend?: number; periodResults?: number }) {
  const spend = periodSpend ?? ad.total_spend;
  const results = periodResults ?? ad.total_results;
  return (
    <>
      <tr className={`border-t border-gray-800/30 ${ad.recommendation === 'KILL' ? 'text-red-400/80' : ''} cursor-pointer hover:bg-gray-800/30`} onClick={onToggle}>
        <td className="py-1 px-1 text-gray-500">
          <BarChart3 size={10} className={expanded ? 'text-lime-400' : ''} />
        </td>
        <td className="py-1 px-1 text-gray-300 font-mono">{ad.ad_name}</td>
        <td className="py-1 px-1 text-right text-gray-300">{fmt(spend)}</td>
        <td className={`py-1 px-1 text-right font-mono ${ad.actblue_revenue > 0 ? 'text-green-400' : 'text-gray-600'}`}>
          {ad.actblue_revenue > 0 ? fmt(ad.actblue_revenue) : '$0'}
        </td>
        <td className={`py-1 px-1 text-right font-mono font-medium ${ad.roi >= 1.3 ? 'text-green-400' : ad.roi > 0 && ad.roi < 1.0 ? 'text-red-400' : ad.roi >= 1.0 ? 'text-yellow-400' : 'text-gray-600'}`}>
          {ad.roi > 0 ? `${ad.roi.toFixed(2)}x` : '-'}
        </td>
        <td className="py-1 px-1 text-right text-gray-300">{results}</td>
        <td className={`py-1 px-1 text-right font-mono ${(results > 0 ? spend / results : 0) > 40 ? 'text-red-400' : (results > 0 ? spend / results : 0) < 25 && results > 0 ? 'text-green-400' : 'text-gray-300'}`}>
          {results > 0 ? fmt(spend / results) : '-'}
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
          {ad.ad_delivery && ad.ad_delivery !== 'active' && ad.ad_delivery !== '' ? (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase rounded bg-gray-700 text-gray-400 border border-gray-600">
              {ad.ad_delivery === 'paused' ? 'PAUSED' : ad.ad_delivery.replace(/_/g, ' ')}
            </span>
          ) : ad.recommendation === 'KILL' ? (
            <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={10} /> KILL</span>
          ) : null}
        </td>
      </tr>
      {expanded && (
        <tr><td colSpan={11}><AdChart adName={ad.ad_name} /></td></tr>
      )}
    </>
  );
}
