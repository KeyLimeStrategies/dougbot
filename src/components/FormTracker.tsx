'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface FormData {
  fundraising_page: string;
  client_name: string;
  short_code: string;
  contribution_count: number;
  total_amount: number;
  first_contribution: string;
  last_contribution: string;
  days_active: number;
  avg_per_day: number;
  is_ad: boolean;
  channel: string;
  daily: { date: string; contributions: number; amount: number }[];
}

interface ClientOption {
  short_code: string;
  name: string;
}

interface ChannelDailyEntry {
  date: string;
  [key: string]: string | number;
}

const CHANNEL_COLORS: Record<string, string> = {
  ads: '#84cc16',
  sms: '#22d3ee',
  email: '#f472b6',
  website: '#fb923c',
  other: '#94a3b8',
};

const CHANNEL_LABELS: Record<string, string> = {
  ads: 'Ads (fbig)',
  sms: 'SMS',
  email: 'Email',
  website: 'Website',
  other: 'Other',
};

export default function FormTracker({ refreshKey }: { refreshKey: number }) {
  const [forms, setForms] = useState<FormData[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [channelDaily, setChannelDaily] = useState<ChannelDailyEntry[]>([]);
  const [clientFilter, setClientFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [useCustomDates, setUseCustomDates] = useState(false);
  const [expandedForms, setExpandedForms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [chartMetric, setChartMetric] = useState<'amount' | 'count'>('amount');
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();

    if (useCustomDates && customStart) {
      params.set('start_date', customStart);
      if (customEnd) params.set('end_date', customEnd);
    } else {
      params.set('days', String(days));
    }

    if (clientFilter !== 'all') params.set('client', clientFilter);
    fetch(`/api/form-tracker?${params}`)
      .then(r => r.json())
      .then(data => {
        setForms(data.forms || []);
        setClients(data.clients || []);
        setChannelDaily(data.channelDaily || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [days, clientFilter, refreshKey, useCustomDates, customStart, customEnd]);

  const toggleExpand = (key: string) => {
    setExpandedForms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const extractFormName = (url: string): string => {
    if (!url || url === '(none)') return '(no form)';
    const pageMatch = url.match(/\/page\/(.+?)(?:\?|$)/);
    if (pageMatch) return pageMatch[1];
    if (!url.includes('/')) return url;
    return url.split('/').pop() || url;
  };

  // Filter forms by search query
  const filteredForms = useMemo(() => {
    if (!searchQuery.trim()) return forms;
    const q = searchQuery.toLowerCase();
    return forms.filter(f => {
      const formName = extractFormName(f.fundraising_page).toLowerCase();
      return formName.includes(q) ||
        f.client_name.toLowerCase().includes(q) ||
        f.channel.toLowerCase().includes(q) ||
        f.fundraising_page.toLowerCase().includes(q);
    });
  }, [forms, searchQuery]);

  const adForms = filteredForms.filter(f => f.is_ad);
  const organicForms = filteredForms.filter(f => !f.is_ad);

  const totalAdAmount = adForms.reduce((s, f) => s + f.total_amount, 0);
  const totalOrganicAmount = organicForms.reduce((s, f) => s + f.total_amount, 0);
  const totalAdContributions = adForms.reduce((s, f) => s + f.contribution_count, 0);
  const totalOrganicContributions = organicForms.reduce((s, f) => s + f.contribution_count, 0);

  // Detect which channels exist in the data
  const allChannels = useMemo(() => {
    const channels = new Set<string>();
    for (const entry of channelDaily) {
      for (const key of Object.keys(entry)) {
        if (key.endsWith('_amount')) {
          channels.add(key.replace('_amount', ''));
        }
      }
    }
    return Array.from(channels).sort();
  }, [channelDaily]);

  const activeChannels = allChannels.filter(ch => !hiddenChannels.has(ch));

  const toggleChannel = (ch: string) => {
    setHiddenChannels(prev => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  // Channel summary totals
  const channelSummary = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    for (const f of forms) {
      if (!totals.has(f.channel)) totals.set(f.channel, { amount: 0, count: 0 });
      const t = totals.get(f.channel)!;
      t.amount += f.total_amount;
      t.count += f.contribution_count;
    }
    return Array.from(totals.entries())
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [forms]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Form Tracker</h2>
      </div>

      {/* Filters Row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="bg-gray-800 text-gray-300 text-sm rounded px-3 py-1.5 border border-gray-700"
        >
          <option value="all">All Clients</option>
          {clients.map(c => (
            <option key={c.short_code} value={c.short_code}>{c.name}</option>
          ))}
        </select>

        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search forms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-gray-800 text-gray-300 text-sm rounded pl-8 pr-3 py-1.5 border border-gray-700 w-52 placeholder-gray-600 focus:border-lime-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-2 ml-auto">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => { setUseCustomDates(false); setDays(d); }}
              className={`px-3 py-1 text-sm rounded ${!useCustomDates && days === d ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => { setUseCustomDates(false); setDays(0); }}
            className={`px-3 py-1 text-sm rounded ${!useCustomDates && days === 0 ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            All
          </button>
        </div>
      </div>

      {/* Date range picker */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 uppercase">Date Range:</span>
        <input
          type="date"
          value={customStart}
          onChange={(e) => { setCustomStart(e.target.value); setUseCustomDates(true); }}
          className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700 focus:border-lime-500 focus:outline-none"
        />
        <span className="text-gray-600">to</span>
        <input
          type="date"
          value={customEnd}
          onChange={(e) => { setCustomEnd(e.target.value); setUseCustomDates(true); }}
          className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700 focus:border-lime-500 focus:outline-none"
        />
        {useCustomDates && (
          <button
            onClick={() => { setUseCustomDates(false); setCustomStart(''); setCustomEnd(''); }}
            className="text-xs text-gray-500 hover:text-white px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
          <div className="text-2xl font-bold text-white">{filteredForms.length}</div>
          <div className="text-xs text-gray-500 uppercase">Total Forms</div>
        </div>
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
          <div className="text-2xl font-bold text-green-400">{adForms.length}</div>
          <div className="text-xs text-gray-500 uppercase">Ad Forms</div>
        </div>
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
          <div className="text-2xl font-bold text-blue-400">{organicForms.length}</div>
          <div className="text-xs text-gray-500 uppercase">Organic Forms</div>
        </div>
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
          <div className="text-2xl font-bold text-lime-400">{fmt(totalAdAmount + totalOrganicAmount)}</div>
          <div className="text-xs text-gray-500 uppercase">Total Raised</div>
        </div>
      </div>

      {/* Channel breakdown cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
        {channelSummary.map(ch => (
          <div
            key={ch.channel}
            className="p-2.5 rounded-lg border bg-gray-900/50"
            style={{ borderColor: `${CHANNEL_COLORS[ch.channel] || '#6b7280'}40` }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || '#6b7280' }} />
              <span className="text-xs font-medium" style={{ color: CHANNEL_COLORS[ch.channel] || '#6b7280' }}>
                {CHANNEL_LABELS[ch.channel] || ch.channel}
              </span>
            </div>
            <div className="text-white font-mono text-sm">{fmt(ch.amount)}</div>
            <div className="text-xs text-gray-500">{ch.count} contributions</div>
          </div>
        ))}
      </div>

      {/* Channel Charts */}
      {channelDaily.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Channel Trends</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setChartMetric('amount')}
                className={`px-3 py-1 text-xs rounded ${chartMetric === 'amount' ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                Revenue
              </button>
              <button
                onClick={() => setChartMetric('count')}
                className={`px-3 py-1 text-xs rounded ${chartMetric === 'count' ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                Contributions
              </button>
            </div>
          </div>
          {/* Channel toggles */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {allChannels.map(channel => {
              const isVisible = !hiddenChannels.has(channel);
              const color = CHANNEL_COLORS[channel] || '#6b7280';
              const label = CHANNEL_LABELS[channel] || channel;
              return (
                <button
                  key={channel}
                  onClick={() => toggleChannel(channel)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                    isVisible ? 'border-opacity-60' : 'bg-gray-800/30 border-gray-800 text-gray-600 line-through'
                  }`}
                  style={isVisible ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={channelDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="date"
                  stroke="#6b7280"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => {
                    const [, m, day] = d.split('-');
                    return `${parseInt(m)}/${parseInt(day)}`;
                  }}
                />
                <YAxis
                  stroke="#6b7280"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => chartMetric === 'amount' ? `$${v}` : String(v)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9ca3af' }}
                  labelFormatter={(d) => {
                    const date = new Date(String(d) + 'T00:00:00');
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  }}
                  formatter={(value, name) => {
                    const v = Number(value) || 0;
                    const channel = String(name).replace(`_${chartMetric === 'amount' ? 'amount' : 'count'}`, '');
                    const label = CHANNEL_LABELS[channel] || channel;
                    return [chartMetric === 'amount' ? fmt(v) : v, label];
                  }}
                />
                <Legend
                  formatter={(value: string) => {
                    const channel = value.replace(`_${chartMetric === 'amount' ? 'amount' : 'count'}`, '');
                    return CHANNEL_LABELS[channel] || channel;
                  }}
                />
                {activeChannels.map(channel => (
                  <Line
                    key={channel}
                    type="monotone"
                    dataKey={`${channel}_${chartMetric === 'amount' ? 'amount' : 'count'}`}
                    stroke={CHANNEL_COLORS[channel] || '#6b7280'}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Forms Table */}
      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading form data...</div>
      ) : filteredForms.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          {searchQuery ? `No forms matching "${searchQuery}"` : 'No form data found. Upload ActBlue CSV data to see contribution forms.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="w-8 py-2 px-2"></th>
                <th className="text-left py-2 px-2">Form</th>
                <th className="text-left py-2 px-2">Channel</th>
                <th className="text-left py-2 px-2">Client</th>
                <th className="text-right py-2 px-2">Contributions</th>
                <th className="text-right py-2 px-2">Total Amount</th>
                <th className="text-right py-2 px-2">Avg/Day</th>
                <th className="text-left py-2 px-2">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filteredForms.map(form => {
                const formKey = `${form.fundraising_page}::${form.short_code}`;
                const isExpanded = expandedForms.has(formKey);
                const formName = extractFormName(form.fundraising_page);
                const channelColor = CHANNEL_COLORS[form.channel] || '#6b7280';
                const channelLabel = CHANNEL_LABELS[form.channel] || form.channel;
                return (
                  <tbody key={formKey}>
                    <tr
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                      onClick={() => toggleExpand(formKey)}
                    >
                      <td className="py-2 px-2 text-gray-500">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="py-2 px-2 text-white font-mono text-xs" title={form.fundraising_page}>
                        {formName}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className="px-2 py-0.5 text-[10px] font-bold uppercase rounded border"
                          style={{
                            backgroundColor: `${channelColor}20`,
                            color: channelColor,
                            borderColor: `${channelColor}40`,
                          }}
                        >
                          {channelLabel}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-gray-400">{form.client_name}</td>
                      <td className="py-2 px-2 text-right text-gray-300">{form.contribution_count}</td>
                      <td className="py-2 px-2 text-right text-white font-mono">{fmt(form.total_amount)}</td>
                      <td className="py-2 px-2 text-right text-gray-400 font-mono">{fmt(form.avg_per_day)}</td>
                      <td className="py-2 px-2 text-gray-500 whitespace-nowrap">
                        {form.last_contribution
                          ? new Date(form.last_contribution + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '-'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="bg-gray-900/80 border-t border-b border-gray-800/50 px-6 py-3">
                            <div className="text-xs text-gray-500 uppercase mb-2">Daily Breakdown</div>
                            {form.daily.length > 0 ? (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-600 uppercase">
                                    <th className="text-left py-1 px-2">Date</th>
                                    <th className="text-right py-1 px-2">Contributions</th>
                                    <th className="text-right py-1 px-2">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {form.daily.map(d => (
                                    <tr key={d.date} className="border-t border-gray-800/30">
                                      <td className="py-1 px-2 text-gray-400">
                                        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      </td>
                                      <td className="py-1 px-2 text-right text-gray-300">{d.contributions}</td>
                                      <td className="py-1 px-2 text-right text-white font-mono">{fmt(d.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="text-gray-600 text-xs">No daily data available.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
