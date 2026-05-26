'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AdminGuard } from '@/components/AdminGuard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SpinnerBlock } from '@/components/ui/spinner';

/**
 * Admin user management page. Designed per ui-design-system.md sec 9.1
 * (page header) and sec 4.5 (form inputs).
 */

interface UserProfile {
  id: string;
  email?: string | null;
  role: 'team_member' | 'admin';
  language_preference: 'zh' | 'en';
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'team_member' | 'admin'>('team_member');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState<
    { email: string; password: string } | null
  >(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const { data } = await res.json();
        setUsers(data ?? []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
    } catch {
      /* ignore */
    }
    setTogglingId(null);
  };

  const handleCreateUser = async () => {
    setFormError('');
    setFormSuccess('');
    setCreatedCredentials(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFormError('Email and password are required.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (password !== password.trim()) {
      setFormError(
        'Password must not start or end with whitespace. Please retype.'
      );
      return;
    }
    // Snapshot the password before any state reset so we can display it
    // back to the admin and avoid the "password silently mutated" class of bug.
    const passwordSnapshot = password;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password: passwordSnapshot,
          role,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        const confirmNote = result.emailConfirmed
          ? '(email confirmed)'
          : '(email may need manual confirmation)';
        setFormSuccess(`User ${trimmedEmail} created. ${confirmNote}`);
        setCreatedCredentials({ email: trimmedEmail, password: passwordSnapshot });
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
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-info hover:underline"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Back to Admin
        </Link>
        <h1 className="mb-8 text-2xl font-semibold text-foreground">
          Manage Users
        </h1>

        {/* Create user form */}
        <div className="mb-10 max-w-2xl rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Create New User
          </h2>
          {formError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg">
              <AlertCircle
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>{formError}</span>
            </div>
          )}
          {formSuccess && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-success/20 bg-success-bg px-3 py-2.5 text-sm text-success-fg">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>{formSuccess}</span>
            </div>
          )}
          {createdCredentials && (
            <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-3 text-sm text-warning-fg">
              <p className="mb-2 font-medium">
                Send these credentials to the new user (shown once):
              </p>
              <div className="space-y-1 font-mono text-xs">
                <div>
                  <span className="text-foreground-muted">Email: </span>
                  <span>{createdCredentials.email}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Password: </span>
                  <span>{createdCredentials.password}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-foreground-muted">
                If the user can't sign in with this exact string, the most
                likely cause is browser autofill mutating the field. Reset
                via Supabase Dashboard → Authentication → Users.
              </p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete="new-password"
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-foreground-subtle">
                {password.length > 0 ? (
                  <>
                    Length: {password.length}{' '}
                    {(password !== password.trim() ||
                      /[\s]/.test(password)) && (
                      <span className="text-warning">
                        — contains whitespace, double-check
                      </span>
                    )}
                  </>
                ) : (
                  '6+ chars. Avoid leading/trailing spaces. Browser autofill is disabled.'
                )}
              </p>
            </div>
            <div>
              <label
                htmlFor="role"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Role
              </label>
              <Select
                id="role"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'team_member' | 'admin')
                }
              >
                <option value="team_member">Team Member</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Button onClick={handleCreateUser} disabled={creating}>
              {creating ? 'Creating...' : 'Create User'}
            </Button>
          </div>
          <p className="mt-4 text-xs text-foreground-subtle">
            Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.
          </p>
        </div>

        {/* Users list */}
        <h2 className="mb-3 text-lg font-semibold text-foreground">All Users</h2>
        {loading ? (
          <SpinnerBlock />
        ) : users.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-foreground-muted">
            No users found.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {u.email ?? u.id}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-foreground-subtle">
                    {u.id}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge
                      variant={u.role === 'admin' ? 'primary' : 'info'}
                    >
                      {u.role}
                    </Badge>
                    <span className="text-xs text-foreground-subtle">
                      Lang: {u.language_preference}
                    </span>
                    <span className="text-xs text-foreground-subtle">
                      Joined: {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleRole(u.id, u.role)}
                  disabled={togglingId === u.id}
                >
                  {togglingId === u.id
                    ? 'Updating...'
                    : u.role === 'admin'
                      ? 'Demote to Team Member'
                      : 'Promote to Admin'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminGuard>
  );
}
