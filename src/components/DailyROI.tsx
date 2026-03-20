'use client';

import { useState, useEffect, useMemo } from 'react';
import { Copy, Check, RotateCw } from 'lucide-react';
import type { DailySummary } from '@/lib/types';

function roasColor(roas: number): string {
  if (roas >= 1.3) return 'text-green-400';
  if (roas >= 1.0) return 'text-yellow-400';
  return 'text-red-400';
}

function roasBg(roas: number): string {
  if (roas >= 1.3) return 'bg-green-900/20';
  if (roas >= 1.0) return 'bg-yellow-900/20';
  return 'bg-red-900/20';
}

interface ClientSummary {
  client_name: string;
  client_id: number;
  total_revenue: number;
  total_spend: number;
  spend_with_fee: number;
  true_roas: number;
  profit: number;
  keylime_cut: number;
}

export default function DailyROI({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ rows: DailySummary[]; portfolioTotals: { date: string; total_spend: number; total_revenue: number; spend_with_fee: number; true_roas: number; profit: number; keylime_cut: number }[] }>({ rows: [], portfolioTotals: [] });
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [days, setDays] = useState(1);
  const [roiText, setRoiText] = useState('');
  const [copied, setCopied] = useState(false);
  const [excludeRecurring, setExcludeRecurring] = useState(false);

  useEffect(() => {
    const params = selectedDate ? `?date=${selectedDate}` : `?days=${days}`;
    const recurParam = excludeRecurring ? '&exclude_recurring=true' : '';
    fetch(`/api/daily-roi${params}${recurParam}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        if (!selectedDate && d.rows.length > 0) {
          const dates = [...new Set(d.rows.map((r: DailySummary) => r.date))].sort().reverse();
          if (dates.length > 0) {
            fetchRoiText(dates[0] as string);
          }
        }
      })
      .catch(console.error);
  }, [selectedDate, days, refreshKey, excludeRecurring]);

  const fetchRoiText = (date: string) => {
    fetch(`/api/roi-text?date=${date}`)
      .then(r => r.json())
      .then(d => setRoiText(d.text || ''))
      .catch(console.error);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(roiText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Group rows by date
  const dates = [...new Set(data.rows.map(r => r.date))].sort().reverse();
  const portfolioMap = new Map(data.portfolioTotals.map(p => [p.date, p]));
  const isMultiDay = days > 1 && !selectedDate && dates.length > 0;

  // Compute range summary: aggregate all rows by client across all dates
  const rangeSummary = useMemo(() => {
    if (!isMultiDay) return null;

    const clientMap = new Map<number, ClientSummary>();
    for (const row of data.rows) {
      const existing = clientMap.get(row.client_id);
      if (existing) {
        existing.total_revenue += row.total_revenue;
        existing.total_spend += row.total_spend;
        existing.spend_with_fee += row.spend_with_fee;
        existing.profit += row.profit;
        existing.keylime_cut += row.keylime_cut;
      } else {
        clientMap.set(row.client_id, {
          client_name: row.client_name,
          client_id: row.client_id,
          total_revenue: row.total_revenue,
          total_spend: row.total_spend,
          spend_with_fee: row.spend_with_fee,
          true_roas: 0,
          profit: row.profit,
          keylime_cut: row.keylime_cut,
        });
      }
    }

    // Calculate ROAS after aggregation
    const clients = Array.from(clientMap.values()).map(c => ({
      ...c,
      true_roas: c.spend_with_fee > 0 ? c.total_revenue / c.spend_with_fee : 0,
    })).sort((a, b) => b.true_roas - a.true_roas);

    const portfolio = clients.reduce(
      (acc, c) => ({
        total_revenue: acc.total_revenue + c.total_revenue,
        total_spend: acc.total_spend + c.total_spend,
        spend_with_fee: acc.spend_with_fee + c.spend_with_fee,
        profit: acc.profit + c.profit,
        keylime_cut: acc.keylime_cut + c.keylime_cut,
      }),
      { total_revenue: 0, total_spend: 0, spend_with_fee: 0, profit: 0, keylime_cut: 0 }
    );

    const portfolioRoas = portfolio.spend_with_fee > 0 ? portfolio.total_revenue / portfolio.spend_with_fee : 0;

    // Build quick share text for the range
    const firstDate = dates[dates.length - 1];
    const lastDate = dates[0];
    const fmtDate = (d: string) => {
      const [, m, day] = d.split('-');
      return `${parseInt(m)}/${parseInt(day)}`;
    };
    const rangeLabel = firstDate === lastDate ? fmtDate(firstDate) : `${fmtDate(firstDate)}-${fmtDate(lastDate)}`;

    let shareText = `${rangeLabel} ROI Summary (with fee):\n`;
    for (const c of clients) {
      const rev = Math.round(c.total_revenue);
      const spend = Math.round(c.spend_with_fee);
      const roas = c.true_roas > 0 ? c.true_roas.toFixed(3) : '0.000';
      shareText += `${c.client_name} ${rev}/${spend}= ${roas}\n`;
    }

    return { clients, portfolio: { ...portfolio, true_roas: portfolioRoas }, shareText, rangeLabel };
  }, [data.rows, isMultiDay, dates]);

  const [rangeCopied, setRangeCopied] = useState(false);
  const handleRangeCopy = () => {
    if (!rangeSummary) return;
    navigator.clipboard.writeText(rangeSummary.shareText);
    setRangeCopied(true);
    setTimeout(() => setRangeCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Daily ROI Summary</h2>
          <button
            onClick={() => setExcludeRecurring(!excludeRecurring)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${
              excludeRecurring
                ? 'bg-orange-900/30 border-orange-700 text-orange-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
            title={excludeRecurring ? 'Showing first-time contributions only' : 'Showing all contributions (including recurring)'}
          >
            <RotateCw size={12} />
            {excludeRecurring ? 'Recurring OFF' : 'Recurring ON'}
          </button>
        </div>
        <div className="flex gap-2">
          {[1, 3, 7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => { setSelectedDate(''); setDays(d); }}
              className={`px-3 py-1 text-sm rounded ${days === d && !selectedDate ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {d === 1 ? 'Latest' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {/* Range Summary (multi-day only) */}
      {rangeSummary && (
        <div className="mb-6">
          {/* Range Quick Share */}
          <div className="bg-gray-800 rounded-lg p-4 mb-4 font-mono text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-xs uppercase tracking-wide">{days}d Summary</span>
              <button onClick={handleRangeCopy} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
                {rangeCopied ? <Check size={14} /> : <Copy size={14} />}
                {rangeCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="text-lime-300 whitespace-pre-wrap">{rangeSummary.shareText}</pre>
          </div>

          {/* Range Summary Table */}
          <div className="overflow-x-auto mb-2">
            <div className="text-sm font-medium text-lime-400 mb-2">{days}d Combined ({rangeSummary.rangeLabel})</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                  <th className="text-left py-2 px-3">Candidate</th>
                  <th className="text-right py-2 px-3">Revenue</th>
                  <th className="text-right py-2 px-3">Spend</th>
                  <th className="text-right py-2 px-3">Spend+Fee</th>
                  <th className="text-right py-2 px-3">ROAS</th>
                  <th className="text-right py-2 px-3">Profit</th>
                  <th className="text-right py-2 px-3">KL Cut</th>
                </tr>
              </thead>
              <tbody>
                {rangeSummary.clients.map(c => (
                  <tr key={c.client_id} className={`border-b border-gray-800/50 ${roasBg(c.true_roas)}`}>
                    <td className="py-2 px-3 text-white font-medium">{c.client_name}</td>
                    <td className="py-2 px-3 text-right text-gray-300">${c.total_revenue.toFixed(0)}</td>
                    <td className="py-2 px-3 text-right text-gray-300">${c.total_spend.toFixed(0)}</td>
                    <td className="py-2 px-3 text-right text-gray-400">${c.spend_with_fee.toFixed(0)}</td>
                    <td className={`py-2 px-3 text-right font-mono font-bold ${roasColor(c.true_roas)}`}>
                      {c.true_roas.toFixed(3)}
                    </td>
                    <td className={`py-2 px-3 text-right ${c.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${c.profit.toFixed(0)}
                    </td>
                    <td className="py-2 px-3 text-right text-lime-400">
                      {c.keylime_cut > 0 ? `$${c.keylime_cut.toFixed(0)}` : '-'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-600 font-semibold">
                  <td className="py-2 px-3 text-white">PORTFOLIO</td>
                  <td className="py-2 px-3 text-right text-gray-200">${rangeSummary.portfolio.total_revenue.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right text-gray-200">${rangeSummary.portfolio.total_spend.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right text-gray-300">${rangeSummary.portfolio.spend_with_fee.toFixed(0)}</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${roasColor(rangeSummary.portfolio.true_roas)}`}>
                    {rangeSummary.portfolio.true_roas.toFixed(3)}
                  </td>
                  <td className={`py-2 px-3 text-right ${rangeSummary.portfolio.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${rangeSummary.portfolio.profit.toFixed(0)}
                  </td>
                  <td className="py-2 px-3 text-right text-lime-400">
                    {rangeSummary.portfolio.keylime_cut > 0 ? `$${rangeSummary.portfolio.keylime_cut.toFixed(0)}` : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-700 my-6" />
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-4">Daily Breakdown</div>
        </div>
      )}

      {/* Single-day Quick Share (only when Latest or specific date selected) */}
      {!isMultiDay && roiText && (
        <div className="bg-gray-800 rounded-lg p-4 mb-4 font-mono text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-xs uppercase tracking-wide">Quick Share Format</span>
            <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="text-lime-300 whitespace-pre-wrap">{roiText}</pre>
        </div>
      )}

      {dates.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No data yet. Sync Meta and ActBlue data to see ROI.
        </div>
      ) : (
        dates.map(date => {
          const dateRows = data.rows.filter(r => r.date === date).sort((a, b) => b.true_roas - a.true_roas);
          const portfolio = portfolioMap.get(date);
          const [, month, day] = date.split('-');

          return (
            <div key={date} className="mb-6">
              <button
                onClick={() => { setSelectedDate(date); fetchRoiText(date); }}
                className="text-sm font-medium text-gray-400 mb-2 hover:text-white"
              >
                {parseInt(month)}/{parseInt(day)}
              </button>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                      <th className="text-left py-2 px-3">Candidate</th>
                      <th className="text-right py-2 px-3">Revenue</th>
                      <th className="text-right py-2 px-3">Spend</th>
                      <th className="text-right py-2 px-3">Spend+Fee</th>
                      <th className="text-right py-2 px-3">ROAS</th>
                      <th className="text-right py-2 px-3">3d ROAS</th>
                      <th className="text-right py-2 px-3">Profit</th>
                      <th className="text-right py-2 px-3">KL Cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateRows.map(row => (
                      <tr key={`${row.date}-${row.client_id}`} className={`border-b border-gray-800/50 ${roasBg(row.true_roas ?? 0)}`}>
                        <td className="py-2 px-3 text-white font-medium">{row.client_name}</td>
                        <td className="py-2 px-3 text-right text-gray-300">${(row.total_revenue ?? 0).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right text-gray-300">${(row.total_spend ?? 0).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right text-gray-400">${(row.spend_with_fee ?? 0).toFixed(0)}</td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${roasColor(row.true_roas ?? 0)}`}>
                          {(row.true_roas ?? 0).toFixed(3)}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${row.rolling_3d_roas ? roasColor(row.rolling_3d_roas) : 'text-gray-600'}`}>
                          {row.rolling_3d_roas ? row.rolling_3d_roas.toFixed(3) : '-'}
                        </td>
                        <td className={`py-2 px-3 text-right ${(row.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${(row.profit ?? 0).toFixed(0)}
                        </td>
                        <td className="py-2 px-3 text-right text-lime-400">
                          {(row.keylime_cut ?? 0) > 0 ? `$${row.keylime_cut.toFixed(0)}` : '-'}
                        </td>
                      </tr>
                    ))}
                    {/* Portfolio total */}
                    {portfolio && (
                      <tr className="border-t-2 border-gray-600 font-semibold">
                        <td className="py-2 px-3 text-white">PORTFOLIO</td>
                        <td className="py-2 px-3 text-right text-gray-200">${(portfolio.total_revenue ?? 0).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right text-gray-200">${(portfolio.total_spend ?? 0).toFixed(0)}</td>
                        <td className="py-2 px-3 text-right text-gray-300">${(portfolio.spend_with_fee ?? 0).toFixed(0)}</td>
                        <td className={`py-2 px-3 text-right font-mono font-bold ${roasColor(portfolio.true_roas ?? 0)}`}>
                          {(portfolio.true_roas ?? 0).toFixed(3)}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600">-</td>
                        <td className={`py-2 px-3 text-right ${(portfolio.profit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${(portfolio.profit ?? 0).toFixed(0)}
                        </td>
                        <td className="py-2 px-3 text-right text-lime-400">
                          {(portfolio.keylime_cut ?? 0) > 0 ? `$${portfolio.keylime_cut.toFixed(0)}` : '-'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
