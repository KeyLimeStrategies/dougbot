'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import type { HistoricalPoint } from '@/lib/types';

const COLORS = [
  '#84cc16', '#22d3ee', '#f472b6', '#fb923c', '#a78bfa',
  '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#e879f9', '#94a3b8',
];

export default function HistoricalTrends({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<HistoricalPoint[]>([]);
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<'true_roas' | 'total_spend' | 'total_revenue'>('true_roas');

  useEffect(() => {
    fetch(`/api/historical?days=${days}`)
      .then(r => r.json())
      .then(d => setData(d.data || []))
      .catch(console.error);
  }, [days, refreshKey]);

  // Transform data for recharts: pivot by date with client columns
  const clients = [...new Set(data.map(d => d.short_code))].sort();
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
      ...values,
    }));

  const metricLabels: Record<string, string> = {
    true_roas: 'True ROAS',
    total_spend: 'Daily Spend ($)',
    total_revenue: 'Daily Revenue ($)',
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

      <div className="flex gap-2 mb-4">
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
              <Legend />
              {metric === 'true_roas' && (
                <>
                  <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="5 5" label={{ value: 'Break-even', position: 'left', fill: '#ef4444', fontSize: 11 }} />
                  <ReferenceLine y={1.3} stroke="#22c55e" strokeDasharray="5 5" label={{ value: 'Target', position: 'left', fill: '#22c55e', fontSize: 11 }} />
                </>
              )}
              {clients.map((client, i) => (
                <Line
                  key={client}
                  type="monotone"
                  dataKey={client}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
