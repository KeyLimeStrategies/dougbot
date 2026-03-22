'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
  daily: { date: string; contributions: number; amount: number }[];
}

interface ClientOption {
  short_code: string;
  name: string;
}

export default function FormTracker({ refreshKey }: { refreshKey: number }) {
  const [forms, setForms] = useState<FormData[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientFilter, setClientFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [expandedForms, setExpandedForms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('days', String(days));
    if (clientFilter !== 'all') params.set('client', clientFilter);
    fetch(`/api/form-tracker?${params}`)
      .then(r => r.json())
      .then(data => {
        setForms(data.forms || []);
        setClients(data.clients || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [days, clientFilter, refreshKey]);

  const toggleExpand = (key: string) => {
    setExpandedForms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const extractFormName = (url: string): string => {
    if (!url || url === '(none)') return '(no form)';
    // Extract the last segment after /page/ or just return the URL
    const pageMatch = url.match(/\/page\/(.+?)(?:\?|$)/);
    if (pageMatch) return pageMatch[1];
    // If it's already just a name (not a URL), return as-is
    if (!url.includes('/')) return url;
    // Fallback: last path segment
    return url.split('/').pop() || url;
  };

  const adForms = forms.filter(f => f.is_ad);
  const organicForms = forms.filter(f => !f.is_ad);

  const totalAdAmount = adForms.reduce((s, f) => s + f.total_amount, 0);
  const totalOrganicAmount = organicForms.reduce((s, f) => s + f.total_amount, 0);
  const totalAdContributions = adForms.reduce((s, f) => s + f.contribution_count, 0);
  const totalOrganicContributions = organicForms.reduce((s, f) => s + f.contribution_count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Form Tracker</h2>
      </div>

      {/* Filters */}
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

        <div className="flex gap-2 ml-auto">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm rounded ${days === d ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => setDays(0)}
            className={`px-3 py-1 text-sm rounded ${days === 0 ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            All
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-900 text-center">
          <div className="text-2xl font-bold text-white">{forms.length}</div>
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

      {/* Ad vs Organic breakdown */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-3 rounded-lg border border-green-800/50 bg-green-900/10">
          <div className="text-sm text-green-400 font-medium mb-1">Ad Forms (fbig)</div>
          <div className="text-white font-mono">{fmt(totalAdAmount)}</div>
          <div className="text-xs text-gray-500">{totalAdContributions} contributions</div>
        </div>
        <div className="p-3 rounded-lg border border-blue-800/50 bg-blue-900/10">
          <div className="text-sm text-blue-400 font-medium mb-1">Organic / Other</div>
          <div className="text-white font-mono">{fmt(totalOrganicAmount)}</div>
          <div className="text-xs text-gray-500">{totalOrganicContributions} contributions</div>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading form data...</div>
      ) : forms.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No form data found. Upload ActBlue CSV data to see contribution forms.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="w-8 py-2 px-2"></th>
                <th className="text-left py-2 px-2">Form</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-left py-2 px-2">Client</th>
                <th className="text-right py-2 px-2">Contributions</th>
                <th className="text-right py-2 px-2">Total Amount</th>
                <th className="text-right py-2 px-2">Avg/Day</th>
                <th className="text-left py-2 px-2">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {forms.map(form => {
                const formKey = `${form.fundraising_page}::${form.short_code}`;
                const isExpanded = expandedForms.has(formKey);
                const formName = extractFormName(form.fundraising_page);
                return (
                  <>
                    <tr
                      key={formKey}
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
                        {form.is_ad ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-green-500/20 text-green-400 border border-green-500/30">
                            AD
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-gray-600/20 text-gray-400 border border-gray-600/30">
                            ORGANIC
                          </span>
                        )}
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
                      <tr key={`${formKey}-daily`}>
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
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
