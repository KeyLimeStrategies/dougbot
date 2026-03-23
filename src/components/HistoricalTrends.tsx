'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Plus, X } from 'lucide-react';
import type { HistoricalPoint } from '@/lib/types';

const COLORS = [
  '#84cc16', '#22d3ee', '#f472b6', '#fb923c', '#a78bfa',
  '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#e879f9', '#94a3b8',
];

interface CampaignChange {
  date: string;
  change_type: string;
  description: string;
  client_name: string;
  short_code: string;
}

export default function HistoricalTrends({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<HistoricalPoint[]>([]);
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<'true_roas' | 'total_spend' | 'total_revenue'>('true_roas');
  const [hiddenClients, setHiddenClients] = useState<Set<string>>(new Set());
  const [excludeRecurring, setExcludeRecurring] = useState(false);
  const [changes, setChanges] = useState<CampaignChange[]>([]);
  const [showChanges, setShowChanges] = useState(true);

  // Log change form
  const [showLogForm, setShowLogForm] = useState(false);
  const [logClient, setLogClient] = useState('');
  const [logDate, setLogDate] = useState('');
  const [logType, setLogType] = useState('budget_change');
  const [logDesc, setLogDesc] = useState('');

  useEffect(() => {
    const recurParam = excludeRecurring ? '&exclude_recurring=true' : '';
    fetch(`/api/historical?days=${days}${recurParam}`)
      .then(r => r.json())
      .then(d => setData(d.data || []))
      .catch(console.error);
  }, [days, refreshKey, excludeRecurring]);

  useEffect(() => {
    fetch(`/api/campaign-changes?days=${days}`)
      .then(r => r.json())
      .then(d => setChanges(d.changes || []))
      .catch(() => {});
  }, [days, refreshKey]);

  const handleLogChange = async () => {
    if (!logClient || !logDate || !logType) return;
    const res = await fetch('/api/campaign-changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_code: logClient, date: logDate, change_type: logType, description: logDesc }),
    });
    const data = await res.json();
    if (data.success) {
      setShowLogForm(false);
      setLogDesc('');
      // Refresh changes
      fetch(`/api/campaign-changes?days=${days}`).then(r => r.json()).then(d => setChanges(d.changes || []));
    }
  };

  const toggleClient = (code: string) => {
    setHiddenClients(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const showAllClients = () => setHiddenClients(new Set());
  const showOnlyClient = (code: string) => {
    const allClients = [...new Set(data.map(d => d.short_code))];
    setHiddenClients(new Set(allClients.filter(c => c !== code)));
  };

  const clients = [...new Set(data.map(d => d.short_code))].sort();
  const visibleClients = clients.filter(c => !hiddenClients.has(c));
  const dateMap = new Map<string, Record<string, number>>();

  for (const point of data) {
    if (!dateMap.has(point.date)) {
      dateMap.set(point.date, {});
    }
    const entry = dateMap.get(point.date)!;
    entry[point.short_code] = point[metric];
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      dateLabel: `${parseInt(date.split('-')[1])}/${parseInt(date.split('-')[2])}`,
      fullDate: date,
      ...values,
    }));

  const metricLabels: Record<string, string> = {
    true_roas: 'True ROAS',
    total_spend: 'Daily Spend ($)',
    total_revenue: 'Daily Revenue ($)',
  };

  const clientNameMap = new Map<string, string>();
  for (const point of data) {
    if (!clientNameMap.has(point.short_code)) {
      clientNameMap.set(point.short_code, point.client_name);
    }
  }

  // Filter changes to only visible clients
  const visibleChanges = showChanges
    ? changes.filter(c => visibleClients.includes(c.short_code))
    : [];

  // Get unique change dates for reference lines
  const changeDates = [...new Set(visibleChanges.map(c => `${parseInt(c.date.split('-')[1])}/${parseInt(c.date.split('-')[2])}`))];

  const changeTypeLabels: Record<string, string> = {
    budget_change: 'Budget',
    status_change: 'Status',
    ad_launched: 'New Ad',
    ad_toggled: 'Ad Toggle',
    campaign_paused: 'Paused',
    campaign_launched: 'Launched',
    creative_change: 'Creative',
    other: 'Change',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Historical Trends</h2>
        <div className="flex gap-2">
          {(['true_roas', 'total_spend', 'total_revenue'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1 text-sm rounded ${metric === m ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {metricLabels[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-2">
          {[7, 14, 30, 60].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm rounded ${days === d ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-gray-700 mx-1" />
        <button
          onClick={() => setExcludeRecurring(!excludeRecurring)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            excludeRecurring
              ? 'bg-orange-900/30 border-orange-700 text-orange-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
          }`}
        >
          {excludeRecurring ? 'Recurring OFF' : 'Recurring ON'}
        </button>
        <div className="w-px h-5 bg-gray-700 mx-1" />
        <button
          onClick={() => setShowChanges(!showChanges)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            showChanges
              ? 'bg-purple-900/30 border-purple-700 text-purple-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
          }`}
        >
          {showChanges ? 'Events ON' : 'Events OFF'}
        </button>
        <button
          onClick={() => { setShowLogForm(!showLogForm); if (!logDate) setLogDate(new Date().toISOString().split('T')[0]); }}
          className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700"
        >
          <Plus size={12} className="inline" /> Log Change
        </button>
      </div>

      {/* Log Change Form */}
      {showLogForm && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-white font-medium">Log Campaign Change</span>
            <button onClick={() => setShowLogForm(false)} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <select value={logClient} onChange={e => setLogClient(e.target.value)} className="bg-gray-900 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1.5">
              <option value="">Client...</option>
              {clients.map(c => <option key={c} value={c}>{clientNameMap.get(c) || c}</option>)}
            </select>
            <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} className="bg-gray-900 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1.5" />
            <select value={logType} onChange={e => setLogType(e.target.value)} className="bg-gray-900 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1.5">
              <option value="budget_change">Budget Change</option>
              <option value="ad_toggled">Ad Toggled On/Off</option>
              <option value="campaign_paused">Campaign Paused</option>
              <option value="campaign_launched">Campaign Launched</option>
              <option value="creative_change">Creative Change</option>
              <option value="other">Other</option>
            </select>
            <button onClick={handleLogChange} disabled={!logClient || !logDate}
              className="bg-lime-600 text-white text-sm rounded px-3 py-1.5 hover:bg-lime-500 disabled:opacity-40">Save</button>
          </div>
          <input type="text" value={logDesc} onChange={e => setLogDesc(e.target.value)} placeholder="Description (optional, e.g. 'Increased Kinter ABX budget to $200/day')"
            className="w-full mt-2 bg-gray-900 border border-gray-600 text-sm text-gray-300 rounded px-2 py-1.5" />
        </div>
      )}

      {/* Client toggles */}
      {clients.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          <button
            onClick={showAllClients}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              hiddenClients.size === 0
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {clients.map((client, i) => {
            const isVisible = !hiddenClients.has(client);
            const color = COLORS[i % COLORS.length];
            const name = clientNameMap.get(client) || client;
            return (
              <button
                key={client}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    showOnlyClient(client);
                  } else {
                    toggleClient(client);
                  }
                }}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  isVisible
                    ? 'border-opacity-60'
                    : 'bg-gray-800/30 border-gray-800 text-gray-600 line-through'
                }`}
                style={isVisible ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
                title={`Click to toggle, Cmd+click to isolate ${name}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {chartData.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No historical data. Upload daily breakdowns from Meta to see trends.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="dateLabel" stroke="#6b7280" tick={{ fontSize: 12 }} />
              <YAxis
                stroke="#6b7280"
                tick={{ fontSize: 12 }}
                domain={metric === 'true_roas' ? [0, 'auto'] : ['auto', 'auto']}
                tickFormatter={metric === 'true_roas' ? (v: number) => v.toFixed(1) : (v: number) => `$${v}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(value) => {
                  const v = Number(value);
                  return metric === 'true_roas' ? v.toFixed(3) : `$${v.toFixed(0)}`;
                }}
              />
              {metric === 'true_roas' && (
                <>
                  <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="5 5" label={{ value: 'Break-even', position: 'left', fill: '#ef4444', fontSize: 11 }} />
                  <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="5 5" label={{ value: 'Target', position: 'left', fill: '#22c55e', fontSize: 11 }} />
                </>
              )}
              {/* Campaign change markers */}
              {changeDates.map((dateLabel, i) => (
                <ReferenceLine key={`change-${i}`} x={dateLabel} stroke="#a855f7" strokeDasharray="3 3" strokeWidth={1} />
              ))}
              {visibleClients.map((client) => {
                const i = clients.indexOf(client);
                return (
                  <Line
                    key={client}
                    type="monotone"
                    dataKey={client}
                    name={clientNameMap.get(client) || client}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Changes Log */}
      {showChanges && visibleChanges.length > 0 && (
        <div className="mt-4 bg-gray-800/50 rounded-lg border border-gray-700 p-3">
          <h4 className="text-xs text-purple-400 uppercase font-medium mb-2">Campaign Changes</h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {visibleChanges.map((ch, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 font-mono w-12 shrink-0">{`${parseInt(ch.date.split('-')[1])}/${parseInt(ch.date.split('-')[2])}`}</span>
                <span className="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 text-[10px]">{changeTypeLabels[ch.change_type] || ch.change_type}</span>
                <span className="text-gray-300">{ch.client_name}</span>
                {ch.description && <span className="text-gray-500">{ch.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
