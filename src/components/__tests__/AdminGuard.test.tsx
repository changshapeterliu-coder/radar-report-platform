import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext } from '@/contexts/AuthContext';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { AdminGuard } from '@/components/AdminGuard';
import type { ReactNode } from 'react';

const baseAuthValue: AuthContextValue = {
  user: null,
  session: null,
  profile: null,
  loading: false,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
};

function renderWithAuth(ui: ReactNode, value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>{ui}</AuthContext.Provider>
  );
}

describe('AdminGuard', () => {
  it('should render children when user is admin', () => {
    const adminValue: AuthContextValue = {
      ...baseAuthValue,
      profile: {
        id: 'admin-1',
        role: 'admin',
        language_preference: 'zh',
        created_at: '2024-01-01T00:00:00Z',
      },
    };

    renderWithAuth(
      <AdminGuard><p>Admin Content</p></AdminGuard>,
      adminValue
    );

    expect(screen.getByText('Admin Content')).toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });

  it('should show access denied for team_member', () => {
    const memberValue: AuthContextValue = {
      ...baseAuthValue,
      profile: {
        id: 'member-1',
        role: 'team_member',
        language_preference: 'zh',
        created_at: '2024-01-01T00:00:00Z',
      },
    };

    renderWithAuth(
      <AdminGuard><p>Admin Content</p></AdminGuard>,
      memberValue
    );

    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('权限不足，您没有权限访问此页面。')).toBeInTheDocument();
  });

  it('should show access denied when no profile (unauthenticated)', () => {
    renderWithAuth(
      <AdminGuard><p>Admin Content</p></AdminGuard>,
      baseAuthValue
    );

    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('should show loading state while auth is loading', () => {
    const loadingValue: AuthContextValue = {
      ...baseAuthValue,
      loading: true,
    };

    renderWithAuth(
      <AdminGuard><p>Admin Content</p></AdminGuard>,
      loadingValue
    );

    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
