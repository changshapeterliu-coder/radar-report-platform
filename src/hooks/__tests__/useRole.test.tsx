import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AuthContext } from '@/contexts/AuthContext';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import type { ReactNode } from 'react';

const baseAuthValue: AuthContextValue = {
  user: null,
  session: null,
  profile: null,
  loading: false,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
};

function createWrapper(value: AuthContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
  };
}

describe('useRole', () => {
  it('should return null role when no profile', () => {
    const { result } = renderHook(() => useRole(), {
      wrapper: createWrapper(baseAuthValue),
    });

    expect(result.current.role).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isTeamMember).toBe(false);
  });

  it('should return admin role correctly', () => {
    const adminValue: AuthContextValue = {
      ...baseAuthValue,
      profile: {
        id: 'user-1',
        role: 'admin',
        language_preference: 'zh',
        created_at: '2024-01-01T00:00:00Z',
      },
    };

    const { result } = renderHook(() => useRole(), {
      wrapper: createWrapper(adminValue),
    });

    expect(result.current.role).toBe('admin');
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isTeamMember).toBe(false);
  });

  it('should return team_member role correctly', () => {
    const memberValue: AuthContextValue = {
      ...baseAuthValue,
      profile: {
        id: 'user-2',
        role: 'team_member',
        language_preference: 'en',
        created_at: '2024-01-01T00:00:00Z',
      },
    };

    const { result } = renderHook(() => useRole(), {
      wrapper: createWrapper(memberValue),
    });

    expect(result.current.role).toBe('team_member');
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isTeamMember).toBe(true);
  });

  it('should reflect loading state', () => {
    const loadingValue: AuthContextValue = {
      ...baseAuthValue,
      loading: true,
    };

    const { result } = renderHook(() => useRole(), {
      wrapper: createWrapper(loadingValue),
    });

    expect(result.current.loading).toBe(true);
  });
});
