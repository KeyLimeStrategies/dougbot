'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, Loader2, CloudDownload, Database } from 'lucide-react';

interface SyncResult {
  shortCode: string;
  success: boolean;
  rowsProcessed?: number;
  error?: string;
}

interface MetaStatus {
  configured: boolean;
  account?: { name: string; id: string };
  token?: { valid: boolean; expiresAt?: string };
}

export default function UploadPanel({ onUploadComplete }: { onUploadComplete: () => void }) {
  // Sync state
  const [syncing, setSyncing] = useState<'none' | 'actblue' | 'meta' | 'all'>('none');
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [metaSyncResult, setMetaSyncResult] = useState<{ success: boolean; adsProcessed?: number; error?: string } | null>(null);
  const [configuredCandidates, setConfiguredCandidates] = useState<string[]>([]);
  const [metaStatus, setMetaStatus] = useState<MetaStatus>({ configured: false });
  const [syncDays, setSyncDays] = useState(3);

  useEffect(() => {
    fetch('/api/sync/actblue')
      .then(res => res.json())
      .then(data => setConfiguredCandidates(data.configured || []))
      .catch(() => {});

    fetch('/api/sync/meta')
      .then(res => res.json())
      .then(data => setMetaStatus(data))
      .catch(() => {});
  }, []);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const getDateRange = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - syncDays);
    return { date_start: fmt(start), date_end: fmt(end) };
  };

  const syncActBlue = async () => {
    const { date_start, date_end } = getDateRange();
    const res = await fetch('/api/sync/actblue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_start, date_end }),
    });
    const data = await res.json();
    return data.candidates || [];
  };

  const syncMeta = async () => {
    const { date_start, date_end } = getDateRange();
    const res = await fetch('/api/sync/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_start, date_end }),
    });
    return res.json();
  };

  const handleSyncAll = async () => {
    setSyncing('all');
    setSyncResults([]);
    setMetaSyncResult(null);

    const [actblueResults, metaResult] = await Promise.allSettled([
      configuredCandidates.length > 0 ? syncActBlue() : Promise.resolve([]),
      metaStatus.configured ? syncMeta() : Promise.resolve(null),
    ]);

    if (actblueResults.status === 'fulfilled') {
      setSyncResults(actblueResults.value);
    } else {
      setSyncResults([{ shortCode: 'all', success: false, error: 'ActBlue sync failed' }]);
    }

    if (metaResult.status === 'fulfilled' && metaResult.value) {
      setMetaSyncResult(metaResult.value);
    } else if (metaResult.status === 'rejected') {
      setMetaSyncResult({ success: false, error: 'Meta sync failed' });
    }

    setSyncing('none');
    onUploadComplete();
  };

  const handleSyncActBlueOnly = async () => {
    setSyncing('actblue');
    setSyncResults([]);
    try {
      const results = await syncActBlue();
      setSyncResults(results);
      onUploadComplete();
    } catch (err) {
      setSyncResults([{ shortCode: 'all', success: false, error: String(err) }]);
    }
    setSyncing('none');
  };

  const handleSyncMetaOnly = async () => {
    setSyncing('meta');
    setMetaSyncResult(null);
    try {
      const result = await syncMeta();
      setMetaSyncResult(result);
      onUploadComplete();
    } catch (err) {
      setMetaSyncResult({ success: false, error: String(err) });
    }
    setSyncing('none');
  };

  const isSyncing = syncing !== 'none';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
      {/* API Sync Section */}
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Database size={20} /> Data Sync
      </h2>

      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs uppercase tracking-wider">Meta:</span>
          {metaStatus.configured ? (
            <span className="px-2 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400 font-medium">
              {metaStatus.account?.name || 'Connected'}
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-500">Not configured</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs uppercase tracking-wider">ActBlue:</span>
          {configuredCandidates.length > 0 ? (
            <div className="flex gap-1">
              {configuredCandidates.map(code => (
                <span key={code} className="px-2 py-0.5 text-xs rounded bg-lime-500/20 text-lime-400 font-medium uppercase">
                  {code}
                </span>
              ))}
            </div>
          ) : (
            <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-500">None</span>
          )}
        </div>
      </div>

      {/* Sync controls */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={syncDays}
          onChange={e => setSyncDays(Number(e.target.value))}
          className="bg-gray-800 border border-gray-600 text-gray-300 text-sm rounded px-3 py-2"
        >
          <option value={1}>Last 1 day</option>
          <option value={3}>Last 3 days</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>

        {/* Sync All button */}
        {(metaStatus.configured || configuredCandidates.length > 0) && (
          <button
            onClick={handleSyncAll}
            disabled={isSyncing}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-50 transition-colors"
          >
            {syncing === 'all' ? (
              <><Loader2 className="animate-spin" size={16} /> Syncing All...</>
            ) : (
              <><CloudDownload size={16} /> Sync All</>
            )}
          </button>
        )}

        {/* Individual sync buttons */}
        {metaStatus.configured && (
          <button
            onClick={handleSyncMetaOnly}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-600/30 disabled:opacity-50 transition-colors"
          >
            {syncing === 'meta' ? <Loader2 className="animate-spin" size={14} /> : <CloudDownload size={14} />}
            Meta
          </button>
        )}

        {configuredCandidates.length > 0 && (
          <button
            onClick={handleSyncActBlueOnly}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-lime-500/20 text-lime-400 hover:bg-lime-500/30 border border-lime-500/30 disabled:opacity-50 transition-colors"
          >
            {syncing === 'actblue' ? <Loader2 className="animate-spin" size={14} /> : <CloudDownload size={14} />}
            ActBlue
          </button>
        )}
      </div>

      {/* Sync Results */}
      {(syncResults.length > 0 || metaSyncResult) && (
        <div className="mb-4 space-y-1.5">
          {metaSyncResult && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${metaSyncResult.success ? 'bg-blue-900/30 text-blue-300' : 'bg-red-900/30 text-red-300'}`}>
              {metaSyncResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              <span className="font-medium">META</span>
              <span className="opacity-75">
                {metaSyncResult.success ? `${metaSyncResult.adsProcessed} ad records synced` : metaSyncResult.error}
              </span>
            </div>
          )}
          {syncResults.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded text-sm ${r.success ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
              {r.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              <span className="font-medium uppercase">{r.shortCode}</span>
              <span className="opacity-75">
                {r.success ? `${r.rowsProcessed} contributions synced` : r.error}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
