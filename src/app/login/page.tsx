'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.success) {
        router.push('/');
        router.refresh();
      } else {
        setError('Wrong password');
      }
    } catch {
      setError('Something went wrong');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-lime-500 flex items-center justify-center font-bold text-black text-lg mx-auto mb-3">
            KL
          </div>
          <h1 className="text-white text-xl font-semibold">Keylime Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Enter your team password</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-lime-500 transition-colors"
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-lg text-sm font-medium bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : null}
            {loading ? 'Checking...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
