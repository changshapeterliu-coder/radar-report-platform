'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function RequestPage() {
  const { user } = useAuth();

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!topic.trim()) return;

    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          description: description.trim() || undefined,
          requesterEmail: user?.email || '',
          requesterName: user?.user_metadata?.full_name || user?.email || '',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to submit request');
      }

      setStatus('success');
      setTopic('');
      setDescription('');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-[#232f3e]">Request a Report Topic</h1>
      <p className="mb-8 text-gray-600">
        Have a topic you&apos;d like us to cover? Submit your request below and our team will review it.
      </p>

      {status === 'success' ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="mb-2 text-lg font-semibold text-green-800">Request Submitted</h2>
          <p className="mb-4 text-green-700">Your report topic request has been sent to the admin team.</p>
          <button
            onClick={() => setStatus('idle')}
            className="rounded-lg bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] transition-colors"
          >
            Submit Another Request
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {status === 'error' && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mb-5">
            <label htmlFor="topic" className="mb-1.5 block text-sm font-medium text-gray-700">
              Topic <span className="text-red-500">*</span>
            </label>
            <input
              id="topic"
              type="text"
              required
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Account Health Dashboard Changes in Q2"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#ff9900] focus:outline-none focus:ring-1 focus:ring-[#ff9900]"
            />
          </div>

          <div className="mb-5">
            <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-gray-700">
              Description <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide additional context or specific areas you'd like covered..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[#ff9900] focus:outline-none focus:ring-1 focus:ring-[#ff9900]"
            />
          </div>

          <div className="mb-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
            Submitting as <span className="font-medium text-gray-900">{user?.email || '—'}</span>
          </div>

          <button
            type="submit"
            disabled={status === 'submitting' || !topic.trim()}
            className="w-full rounded-lg bg-[#ff9900] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#e88b00] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      )}
    </div>
  );
}
