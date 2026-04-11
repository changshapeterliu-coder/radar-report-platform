'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import Link from 'next/link';

interface UserProfile {
  id: string;
  email?: string | null;
  email_confirmed?: boolean;
  role: 'team_member' | 'admin';
  language_preference: 'zh' | 'en';
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Create user form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'team_member' | 'admin'>('team_member');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const { data } = await res.json();
        setUsers(data ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleToggleRole = async (userId: string, currentRole: string) => {
    setTogglingId(userId);
    const newRole = currentRole === 'admin' ? 'team_member' : 'admin';
    try {
      await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });
      fetchUsers();
    } catch { /* ignore */ }
    setTogglingId(null);
  };

  const handleCreateUser = async () => {
    setFormError('');
    setFormSuccess('');
    if (!email.trim() || !password.trim()) {
      setFormError('Email and password are required.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      if (res.ok) {
        const result = await res.json();
        const confirmNote = result.emailConfirmed
          ? '(email confirmed ✓)'
          : '(⚠️ email may need manual confirmation)';
        setFormSuccess(`User ${email} created successfully. ${confirmNote}`);
        setEmail('');
        setPassword('');
        setRole('team_member');
        fetchUsers();
      } else {
        const data = await res.json();
        setFormError(data.message || 'Failed to create user');
      }
    } catch {
      setFormError('Network error');
    }
    setCreating(false);
  };

  return (
    <AdminGuard>
      <div>
        <Link href="/admin" className="mb-4 inline-block text-sm text-[#146eb4] hover:underline">
          ← Back to Admin
        </Link>
        <h1 className="text-2xl font-bold text-[#232f3e] mb-6">👥 Manage Users</h1>

        {/* Create User Form */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8 max-w-2xl">
          <h2 className="text-lg font-bold text-[#232f3e] mb-4">Create New User</h2>
          {formError && (
            <div className="mb-4 rounded border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-600">{formError}</p>
            </div>
          )}
          {formSuccess && (
            <div className="mb-4 rounded border border-green-300 bg-green-50 p-3">
              <p className="text-sm text-green-600">{formSuccess}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#ff9900] focus:outline-none"
                placeholder="Minimum 6 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'team_member' | 'admin')}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="team_member">Team Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              onClick={handleCreateUser}
              disabled={creating}
              className="rounded bg-[#ff9900] px-4 py-2 text-sm font-medium text-white hover:bg-[#e88b00] disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Note: Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.
          </p>
        </div>

        {/* Users List */}
        <h2 className="text-lg font-bold text-[#232f3e] mb-3">All Users</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[#ff9900] border-r-transparent" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No users found.</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white rounded-lg border border-gray-200 p-4">
                <div>
                  <p className="font-medium text-sm text-[#232f3e]">
                    {u.email ?? u.id}
                    {u.email_confirmed === false && (
                      <span className="ml-2 text-xs text-red-500 font-normal">⚠️ email not confirmed</span>
                    )}
                    {u.email_confirmed === true && (
                      <span className="ml-2 text-xs text-green-500 font-normal">✓ confirmed</span>
                    )}
                  </p>
                  {u.email && (
                    <p className="font-mono text-xs text-gray-400 mt-0.5">{u.id}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                      u.role === 'admin'
                        ? 'bg-purple-100 text-purple-700 border border-purple-300'
                        : 'bg-blue-100 text-[#146eb4] border border-blue-300'
                    }`}>
                      {u.role}
                    </span>
                    <span className="text-xs text-gray-400">Lang: {u.language_preference}</span>
                    <span className="text-xs text-gray-400">
                      Joined: {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleToggleRole(u.id, u.role)}
                  disabled={togglingId === u.id}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#232f3e] hover:bg-gray-50 disabled:opacity-50"
                >
                  {togglingId === u.id
                    ? 'Updating...'
                    : u.role === 'admin'
                      ? 'Demote to Team Member'
                      : 'Promote to Admin'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminGuard>
  );
}
