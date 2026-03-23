'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, Loader2, Plus, Trash2, Shield, Power } from 'lucide-react';

interface ClientCredStatus {
  id: number;
  short_code: string;
  name: string;
  entity_name: string;
  fee_rate: number;
  active: boolean;
  is_ad_client: boolean;
  has_actblue: boolean;
  source: 'db' | 'env' | null;
}

export default function Settings() {
  const [clients, setClients] = useState<ClientCredStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Add credential form
  const [showForm, setShowForm] = useState(false);
  const [selectedClient, setSelectedClient] = useState('');
  const [uuid, setUuid] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingFee, setEditingFee] = useState<string | null>(null);
  const [feeValue, setFeeValue] = useState('');

  // New client form
  const [showNewClient, setShowNewClient] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newEntity, setNewEntity] = useState('');
  const [newIsAd, setNewIsAd] = useState(true);
  const [newFee, setNewFee] = useState('10');
  const [savingClient, setSavingClient] = useState(false);

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/settings/credentials');
      const data = await res.json();
      setClients(data.clients || []);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { fetchClients(); }, []);

  const handleSave = async () => {
    if (!selectedClient || !uuid || !secret) {
      setMessage({ type: 'error', text: 'All fields are required' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_code: selectedClient,
          client_uuid: uuid,
          client_secret: secret,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Connected ${selectedClient.toUpperCase()}` });
        setShowForm(false);
        setUuid('');
        setSecret('');
        setSelectedClient('');
        fetchClients();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) });
    }
    setSaving(false);
  };

  const handleRemove = async (shortCode: string) => {
    try {
      await fetch('/api/settings/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_code: shortCode }),
      });
      fetchClients();
    } catch {
      // ignore
    }
  };

  const handleFeeUpdate = async (shortCode: string, newRate: number) => {
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_code: shortCode, fee_rate: newRate / 100 }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingFee(null);
        fetchClients();
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update fee rate' });
    }
  };

  const handleCreateClient = async () => {
    if (!newName || !newCode) {
      setMessage({ type: 'error', text: 'Name and short code are required' });
      return;
    }
    setSavingClient(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          short_code: newCode,
          name: newName,
          entity_name: newEntity || newName,
          is_ad_client: newIsAd,
          fee_rate: parseFloat(newFee) || 10,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: data.message });
        setShowNewClient(false);
        setNewName(''); setNewCode(''); setNewEntity(''); setNewIsAd(true); setNewFee('10');
        fetchClients();
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) });
    }
    setSavingClient(false);
  };

  const handleToggleAdClient = async (shortCode: string, isAd: boolean) => {
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_code: shortCode, is_ad_client: isAd }),
      });
      const data = await res.json();
      if (data.success) fetchClients();
      else setMessage({ type: 'error', text: data.error });
    } catch {
      setMessage({ type: 'error', text: 'Failed to update' });
    }
  };

  const handleToggleActive = async (shortCode: string, active: boolean) => {
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_code: shortCode, active }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: data.message });
        fetchClients();
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update client status' });
    }
  };

  const activeClients = clients.filter(c => c.active);
  const inactiveClients = clients.filter(c => !c.active);
  const connected = clients.filter(c => c.has_actblue);
  const notConnected = clients.filter(c => !c.has_actblue);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading...
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
        <Shield size={22} /> API Credentials
      </h2>

      {/* Connected clients */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          ActBlue Connected ({connected.length}/{clients.length})
        </h3>
        {connected.length === 0 ? (
          <p className="text-gray-500 text-sm">No candidates connected yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {connected.map(c => (
              <div key={c.short_code} className="flex items-center justify-between bg-green-900/20 border border-green-800/50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <div>
                    <span className="text-white font-medium">{c.name}</span>
                    <span className="text-gray-500 text-xs ml-2">({c.short_code})</span>
                  </div>
                </div>
                {c.source === 'db' && (
                  <button
                    onClick={() => handleRemove(c.short_code)}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1"
                    title="Remove credentials"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                {c.source === 'env' && (
                  <span className="text-xs text-gray-600">.env</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Not connected */}
      {notConnected.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Not Connected
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {notConnected.map(c => (
              <div key={c.short_code} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-gray-600" />
                  <div>
                    <span className="text-gray-300">{c.name}</span>
                    <span className="text-gray-600 text-xs ml-2">({c.short_code})</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedClient(c.short_code);
                    setShowForm(true);
                    setMessage(null);
                  }}
                  className="text-lime-400 hover:text-lime-300 transition-colors text-xs font-medium"
                >
                  + Connect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add credentials form */}
      {showForm && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-5 mb-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <Plus size={16} />
            Add ActBlue Credentials
            {selectedClient && (
              <span className="text-lime-400 uppercase font-bold">({selectedClient})</span>
            )}
          </h3>

          <div className="space-y-3">
            {!selectedClient && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Client</label>
                <select
                  value={selectedClient}
                  onChange={e => setSelectedClient(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="">Select candidate...</option>
                  {notConnected.map(c => (
                    <option key={c.short_code} value={c.short_code}>
                      {c.name} ({c.short_code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">Client UUID</label>
              <input
                type="text"
                value={uuid}
                onChange={e => setUuid(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Client Secret</label>
              <input
                type="password"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder="Paste client secret..."
                className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            </div>

            <p className="text-xs text-gray-500">
              Generate credentials from ActBlue Dashboard: Admin &gt; API Credentials
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                {saving ? 'Verifying...' : 'Test & Save'}
              </button>
              <button
                onClick={() => { setShowForm(false); setMessage(null); setUuid(''); setSecret(''); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {!showForm && (
        <div className="flex gap-2">
          <button
            onClick={() => { setShowForm(true); setSelectedClient(''); setMessage(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
          >
            <Plus size={16} /> Add ActBlue Credentials
          </button>
          <button
            onClick={() => { setShowNewClient(true); setMessage(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-lime-600 text-white hover:bg-lime-500 transition-colors"
          >
            <Plus size={16} /> Add New Client
          </button>
        </div>
      )}

      {/* New Client Form */}
      {showNewClient && (
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-5 mb-4 mt-4">
          <h3 className="text-white font-medium mb-4 flex items-center gap-2">
            <Plus size={16} /> Create New Client
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Client Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Short Code (ad prefix)</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="e.g. js"
                  className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Entity Name (optional, for matching)</label>
              <input
                type="text"
                value={newEntity}
                onChange={e => setNewEntity(e.target.value)}
                placeholder="e.g. Jane Smith for Congress"
                className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Fee Rate (%)</label>
                <input
                  type="number"
                  value={newFee}
                  onChange={e => setNewFee(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 text-gray-300 rounded px-3 py-2 text-sm"
                  min="0" max="100"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Client Type</label>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setNewIsAd(true)}
                    className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                      newIsAd ? 'bg-lime-900/30 border-lime-700 text-lime-300' : 'bg-gray-900 border-gray-600 text-gray-400'
                    }`}
                  >
                    Ad Client
                  </button>
                  <button
                    onClick={() => setNewIsAd(false)}
                    className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                      !newIsAd ? 'bg-cyan-900/30 border-cyan-700 text-cyan-300' : 'bg-gray-900 border-gray-600 text-gray-400'
                    }`}
                  >
                    Non-Ad
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {newIsAd
                ? 'Ad clients appear in Daily ROI, Ad Performance, and Insights tabs.'
                : 'Non-ad clients are tracked in Forms only (text, email, website donations).'}
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCreateClient}
                disabled={savingClient || !newName || !newCode}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-50 transition-colors"
              >
                {savingClient ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                {savingClient ? 'Creating...' : 'Create Client'}
              </button>
              <button
                onClick={() => { setShowNewClient(false); setMessage(null); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Status (Active/Inactive) */}
      <div className="mt-8 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Power size={20} /> Client Status
        </h2>
        <p className="text-gray-500 text-sm mb-4">
          Deactivated clients are hidden from ROI summaries, graphs, and ad performance.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {activeClients.map(c => (
            <div key={c.short_code} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-white font-medium">{c.name}</span>
                <span className="text-gray-600 text-xs">({c.short_code})</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.is_ad_client ? 'bg-lime-900/30 text-lime-400' : 'bg-cyan-900/30 text-cyan-400'}`}>
                  {c.is_ad_client ? 'ADS' : 'NON-AD'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleAdClient(c.short_code, !c.is_ad_client)}
                  className="text-gray-500 hover:text-gray-300 transition-colors text-xs"
                  title={c.is_ad_client ? 'Switch to non-ad' : 'Switch to ad client'}
                >
                  {c.is_ad_client ? 'Make Non-Ad' : 'Make Ad'}
                </button>
                <button
                  onClick={() => handleToggleActive(c.short_code, false)}
                  className="text-gray-500 hover:text-red-400 transition-colors text-xs font-medium"
                >
                  Deactivate
                </button>
              </div>
            </div>
          ))}
          {inactiveClients.map(c => (
            <div key={c.short_code} className="flex items-center justify-between bg-gray-800/30 border border-gray-800 rounded-lg px-4 py-3 opacity-60">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-600" />
                <span className="text-gray-400 font-medium">{c.name}</span>
                <span className="text-gray-600 text-xs">({c.short_code})</span>
              </div>
              <button
                onClick={() => handleToggleActive(c.short_code, true)}
                className="text-lime-400 hover:text-lime-300 transition-colors text-xs font-medium"
              >
                Activate
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Client Fee Rates */}
      <div className="mt-8 mb-6">
        <h2 className="text-xl font-semibold text-white mb-4">Management Fee Rates</h2>
        <p className="text-gray-500 text-sm mb-4">
          KL Cut = admin fee (spend x rate) + 25% of true profit (revenue - spend - admin fee), when profitable.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {clients.map(c => (
            <div key={c.short_code} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{c.name}</span>
              </div>
              {editingFee === c.short_code ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={feeValue}
                    onChange={e => setFeeValue(e.target.value)}
                    className="w-16 bg-gray-900 border border-gray-500 text-white text-sm rounded px-2 py-1 text-right"
                    min="0"
                    max="100"
                    step="1"
                  />
                  <span className="text-gray-400 text-sm">%</span>
                  <button
                    onClick={() => handleFeeUpdate(c.short_code, parseFloat(feeValue))}
                    className="text-lime-400 hover:text-lime-300 text-xs font-medium ml-1"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingFee(null)}
                    className="text-gray-500 hover:text-gray-300 text-xs ml-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditingFee(c.short_code);
                    setFeeValue(String(Math.round((c.fee_rate ?? 0.10) * 100)));
                  }}
                  className={`text-sm font-mono font-medium px-2 py-1 rounded hover:bg-gray-700 transition-colors ${
                    (c.fee_rate ?? 0.10) !== 0.10 ? 'text-yellow-400' : 'text-gray-300'
                  }`}
                >
                  {Math.round((c.fee_rate ?? 0.10) * 100)}%
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
        }`}>
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}
    </div>
  );
}
