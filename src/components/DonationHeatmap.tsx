'use client';

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Clock, DollarSign, Hash } from 'lucide-react';

interface HourlyData {
  hour: number;
  count: number;
  total_amount: number;
  avg_amount: number;
  avg_per_day: number;
}

interface DayHourData {
  day_of_week: number;
  hour: number;
  count: number;
  total_amount: number;
}

interface ClientHourData {
  client: string;
  client_name: string;
  hour: number;
  count: number;
  total_amount: number;
}

interface HeatmapResponse {
  date_range: { start: string; end: string; days: number };
  hourly: HourlyData[];
  day_hour: DayHourData[];
  by_client: ClientHourData[];
  coverage: { total: number; with_hour: number };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return '12a';
  if (i < 12) return `${i}a`;
  if (i === 12) return '12p';
  return `${i - 12}p`;
});

// Color scale: transparent -> lime green (matching brand)
function getHeatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'rgba(132, 204, 22, 0.05)';
  const intensity = Math.min(value / max, 1);
  // Clamp to 0.08 - 1.0 range for visibility
  const alpha = 0.08 + intensity * 0.92;
  return `rgba(132, 204, 22, ${alpha.toFixed(2)})`;
}

function getAmountHeatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'rgba(34, 211, 238, 0.05)';
  const intensity = Math.min(value / max, 1);
  const alpha = 0.08 + intensity * 0.92;
  return `rgba(34, 211, 238, ${alpha.toFixed(2)})`;
}

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

export default function DonationHeatmap({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState<'count' | 'amount'>('count');
  const [clientFilter, setClientFilter] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (clientFilter) params.set('client', clientFilter);

    fetch(`/api/heatmap?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey, days, clientFilter]);

  // Build day x hour grid
  const grid = useMemo(() => {
    if (!data) return null;

    // 7 days x 24 hours grid
    const cells: Record<string, { count: number; amount: number }> = {};
    let maxCount = 0;
    let maxAmount = 0;

    for (const d of data.day_hour) {
      const key = `${d.day_of_week}-${d.hour}`;
      cells[key] = { count: d.count, amount: d.total_amount };
      if (d.count > maxCount) maxCount = d.count;
      if (d.total_amount > maxAmount) maxAmount = d.total_amount;
    }

    return { cells, maxCount, maxAmount };
  }, [data]);

  // Bar chart data for hourly totals
  const barData = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const entry = data.hourly.find(d => d.hour === h);
      return {
        hour: HOUR_LABELS[h],
        count: entry?.count || 0,
        amount: entry?.total_amount || 0,
        avg_per_day: entry?.avg_per_day || 0,
        avg_donation: entry?.avg_amount || 0,
      };
    });
  }, [data]);

  // Get unique clients for filter
  const clients = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, string>();
    for (const c of data.by_client) {
      if (!seen.has(c.client)) seen.set(c.client, c.client_name);
    }
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
  }, [data]);

  // Peak hours
  const peakHours = useMemo(() => {
    if (!data || data.hourly.length === 0) return { byCount: null, byAmount: null };
    const byCount = [...data.hourly].sort((a, b) => b.count - a.count)[0];
    const byAmount = [...data.hourly].sort((a, b) => b.total_amount - a.total_amount)[0];
    return { byCount, byAmount };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <div className="animate-pulse">Loading heatmap data...</div>
      </div>
    );
  }

  if (!data || data.hourly.length === 0) {
    return (
      <div className="text-center py-20">
        <Clock className="mx-auto mb-3 text-gray-600" size={40} />
        <p className="text-gray-400 text-lg">No hourly data available yet</p>
        <p className="text-gray-600 text-sm mt-2">
          Contribution times are captured during ActBlue syncs. Sync data to populate the heatmap.
        </p>
      </div>
    );
  }

  const coveragePct = data.coverage.total > 0
    ? Math.round((data.coverage.with_hour / data.coverage.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock size={22} />
            Donation Time of Day
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            fbig form contributions by hour (Eastern Time), {data.date_range.start} to {data.date_range.end}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Client filter */}
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="bg-gray-800 border border-gray-600 text-gray-300 text-sm rounded px-3 py-1.5"
          >
            <option value="">All clients</option>
            {clients.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>

          {/* Period selector */}
          <div className="flex bg-gray-800 rounded-lg p-0.5">
            {[3, 7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === d ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          {/* Metric toggle */}
          <div className="flex bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setMetric('count')}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === 'count' ? 'bg-lime-600 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Hash size={12} /> Count
            </button>
            <button
              onClick={() => setMetric('amount')}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === 'amount' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <DollarSign size={12} /> Amount
            </button>
          </div>
        </div>
      </div>

      {/* Peak hour cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {peakHours.byCount && (
          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Peak Hour (Volume)</p>
            <p className="text-white text-xl font-bold">{formatHour(peakHours.byCount.hour)}</p>
            <p className="text-lime-400 text-sm">{peakHours.byCount.count} contributions</p>
          </div>
        )}
        {peakHours.byAmount && (
          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Peak Hour (Revenue)</p>
            <p className="text-white text-xl font-bold">{formatHour(peakHours.byAmount.hour)}</p>
            <p className="text-cyan-400 text-sm">${peakHours.byAmount.total_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        )}
        <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Total Contributions</p>
          <p className="text-white text-xl font-bold">{data.hourly.reduce((s, h) => s + h.count, 0).toLocaleString()}</p>
          <p className="text-gray-400 text-sm">{days}-day period</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
          <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Data Coverage</p>
          <p className="text-white text-xl font-bold">{coveragePct}%</p>
          <p className="text-gray-400 text-sm">{data.coverage.with_hour} of {data.coverage.total} have time data</p>
        </div>
      </div>

      {/* Hourly bar chart */}
      <div className="bg-gray-800/40 rounded-lg border border-gray-700/50 p-4">
        <h3 className="text-gray-300 text-sm font-medium mb-3">
          {metric === 'count' ? 'Contributions by Hour' : 'Revenue by Hour'}
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="hour" stroke="#666" fontSize={11} interval={1} />
            <YAxis
              stroke="#666"
              fontSize={11}
              tickFormatter={v => metric === 'amount' ? `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}` : String(v)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
              labelStyle={{ color: '#fff', fontWeight: 600 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any) => {
                const v = Number(value);
                if (metric === 'count') return [v.toLocaleString(), 'Contributions'];
                return [`$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Revenue'];
              }}
            />
            <Bar
              dataKey={metric === 'count' ? 'count' : 'amount'}
              fill={metric === 'count' ? '#84cc16' : '#22d3ee'}
              radius={[3, 3, 0, 0]}
              fillOpacity={0.85}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Day x Hour heatmap grid */}
      {grid && (
        <div className="bg-gray-800/40 rounded-lg border border-gray-700/50 p-4">
          <h3 className="text-gray-300 text-sm font-medium mb-3">Day of Week x Hour Heatmap</h3>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Hour labels */}
              <div className="flex ml-12 mb-1">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[10px] text-gray-500">
                    {h % 3 === 0 ? HOUR_LABELS[h] : ''}
                  </div>
                ))}
              </div>

              {/* Grid rows */}
              {DAY_NAMES.map((dayName, dayIdx) => (
                <div key={dayIdx} className="flex items-center mb-[2px]">
                  <div className="w-12 text-right pr-2 text-xs text-gray-400 font-medium">{dayName}</div>
                  <div className="flex flex-1 gap-[2px]">
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = grid.cells[`${dayIdx}-${h}`];
                      const value = cell ? (metric === 'count' ? cell.count : cell.amount) : 0;
                      const max = metric === 'count' ? grid.maxCount : grid.maxAmount;
                      const color = metric === 'count'
                        ? getHeatColor(value, max)
                        : getAmountHeatColor(value, max);

                      return (
                        <div
                          key={h}
                          className="flex-1 rounded-sm cursor-default transition-transform hover:scale-110"
                          style={{
                            backgroundColor: color,
                            height: '28px',
                          }}
                          title={`${dayName} ${formatHour(h)}: ${metric === 'count'
                            ? `${value} contributions`
                            : `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Legend */}
              <div className="flex items-center justify-end mt-2 gap-2">
                <span className="text-[10px] text-gray-500">Less</span>
                {[0.05, 0.2, 0.4, 0.6, 0.8, 1.0].map((intensity, i) => (
                  <div
                    key={i}
                    className="w-3 h-3 rounded-sm"
                    style={{
                      backgroundColor: metric === 'count'
                        ? `rgba(132, 204, 22, ${intensity})`
                        : `rgba(34, 211, 238, ${intensity})`,
                    }}
                  />
                ))}
                <span className="text-[10px] text-gray-500">More</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-client hourly breakdown */}
      {!clientFilter && clients.length > 1 && (
        <div className="bg-gray-800/40 rounded-lg border border-gray-700/50 p-4">
          <h3 className="text-gray-300 text-sm font-medium mb-3">By Client</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map(({ code, name }) => {
              const clientData = data.by_client.filter(d => d.client === code);
              const peak = clientData.length > 0
                ? clientData.reduce((a, b) => (metric === 'count' ? b.count > a.count : b.total_amount > a.total_amount) ? b : a)
                : null;
              const total = clientData.reduce((s, d) => s + (metric === 'count' ? d.count : d.total_amount), 0);

              // Mini sparkline-style row of 24 hourly bars
              const maxVal = Math.max(...clientData.map(d => metric === 'count' ? d.count : d.total_amount), 1);

              return (
                <div
                  key={code}
                  className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/30 cursor-pointer hover:border-gray-600 transition-colors"
                  onClick={() => setClientFilter(code)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-medium text-sm">{name}</span>
                    <span className="text-gray-400 text-xs">
                      {metric === 'count'
                        ? `${total} contribs`
                        : `$${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      }
                    </span>
                  </div>
                  {peak && (
                    <p className="text-gray-500 text-xs mb-2">
                      Peak: {formatHour(peak.hour)} ({metric === 'count'
                        ? `${peak.count} contribs`
                        : `$${peak.total_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      })
                    </p>
                  )}
                  {/* Mini hourly bars */}
                  <div className="flex items-end gap-[1px] h-8">
                    {Array.from({ length: 24 }, (_, h) => {
                      const entry = clientData.find(d => d.hour === h);
                      const val = entry ? (metric === 'count' ? entry.count : entry.total_amount) : 0;
                      const heightPct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                      return (
                        <div
                          key={h}
                          className="flex-1 rounded-sm"
                          style={{
                            height: `${Math.max(heightPct, 2)}%`,
                            backgroundColor: metric === 'count'
                              ? `rgba(132, 204, 22, ${val > 0 ? 0.3 + (val / maxVal) * 0.7 : 0.05})`
                              : `rgba(34, 211, 238, ${val > 0 ? 0.3 + (val / maxVal) * 0.7 : 0.05})`,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-gray-600">12a</span>
                    <span className="text-[9px] text-gray-600">12p</span>
                    <span className="text-[9px] text-gray-600">12a</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
