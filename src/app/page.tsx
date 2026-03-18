'use client';

import { useState } from 'react';
import { BarChart3, Zap, TrendingUp, RefreshCw, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import UploadPanel from '@/components/UploadPanel';
import DailyROI from '@/components/DailyROI';
import AdPerformance from '@/components/AdPerformance';
import HistoricalTrends from '@/components/HistoricalTrends';
import Settings from '@/components/Settings';
import Insights from '@/components/Insights';

type Tab = 'roi' | 'ads' | 'trends' | 'insights' | 'settings';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('roi');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showUpload, setShowUpload] = useState(false);

  const refresh = () => setRefreshKey(k => k + 1);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'roi', label: 'Daily ROI', icon: <BarChart3 size={18} /> },
    { id: 'ads', label: 'Ad Performance', icon: <Zap size={18} /> },
    { id: 'trends', label: 'Trends', icon: <TrendingUp size={18} /> },
    { id: 'insights', label: 'Insights', icon: <Sparkles size={18} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="border-b border-gray-800 bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-lime-500 flex items-center justify-center font-bold text-black text-sm">
              KL
            </div>
            <div>
              <h1 className="text-white font-semibold">Keylime Dashboard</h1>
              <p className="text-gray-500 text-xs">Meta Ads ROI Tracker</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Refresh data"
            >
              <RefreshCw size={18} />
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                showUpload ? 'bg-lime-500 text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Data Sync
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Upload panel */}
        {showUpload && (
          <div className="mb-6">
            <UploadPanel onUploadComplete={refresh} />
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
          {activeTab === 'roi' && <DailyROI refreshKey={refreshKey} />}
          {activeTab === 'ads' && <AdPerformance refreshKey={refreshKey} />}
          {activeTab === 'trends' && <HistoricalTrends refreshKey={refreshKey} />}
          {activeTab === 'insights' && <Insights />}
          {activeTab === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}
