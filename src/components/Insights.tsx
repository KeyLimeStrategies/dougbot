'use client';

import { useState } from 'react';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';

export default function Insights() {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success) {
        setReport(data.report);
      } else {
        setError(data.error || 'Failed to generate insights');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Sparkles size={22} className="text-purple-400" /> Extract Insights
        </h2>
      </div>

      <p className="text-gray-500 text-sm mb-4">
        Uses Claude to analyze your Meta and ActBlue data, identifying top/bottom performers, recommending immediate actions, and surfacing portfolio trends.
      </p>

      <button
        onClick={generateReport}
        disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 transition-colors mb-4"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={16} /> Analyzing portfolio...
          </>
        ) : (
          <>
            <Sparkles size={16} /> Generate Insights Report
          </>
        )}
      </button>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/30 text-red-300 text-sm mb-4">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {report && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-5">
          <div className="prose prose-invert prose-sm max-w-none">
            {report.split('\n').map((line, i) => {
              if (line.startsWith('**') && line.endsWith('**')) {
                return <h3 key={i} className="text-white font-semibold text-base mt-4 mb-2">{line.replace(/\*\*/g, '')}</h3>;
              }
              if (line.match(/^\d+\.\s\*\*/)) {
                const clean = line.replace(/\*\*/g, '');
                return <h3 key={i} className="text-white font-semibold text-base mt-4 mb-2">{clean}</h3>;
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                const content = line.slice(2);
                return (
                  <div key={i} className="flex gap-2 text-gray-300 mb-1 ml-2">
                    <span className="text-gray-600 shrink-0">-</span>
                    <span dangerouslySetInnerHTML={{
                      __html: content
                        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
                        .replace(/`(.+?)`/g, '<code class="text-lime-400 bg-gray-900 px-1 rounded text-xs">$1</code>')
                    }} />
                  </div>
                );
              }
              if (line.trim() === '') return <div key={i} className="h-2" />;
              return (
                <p key={i} className="text-gray-300 mb-1" dangerouslySetInnerHTML={{
                  __html: line
                    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
                    .replace(/`(.+?)`/g, '<code class="text-lime-400 bg-gray-900 px-1 rounded text-xs">$1</code>')
                }} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
