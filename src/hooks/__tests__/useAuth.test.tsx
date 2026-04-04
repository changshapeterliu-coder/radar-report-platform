import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { AuthContext } from '@/contexts/AuthContext';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import type { ReactNode } from 'react';

const mockAuthValue: AuthContextValue = {
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

describe('useAuth', () => {
  it('should return auth context value when used within AuthProvider', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(mockAuthValue),
    });

    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
  });

  it('should throw when used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');
  });

  it('should return user and profile when authenticated', () => {
    const authedValue: AuthContextValue = {
      ...mockAuthValue,
      user: { id: 'user-1', email: 'test@example.com' } as AuthContextValue['user'],
      profile: {
        id: 'user-1',
        role: 'admin',
        language_preference: 'zh',
        created_at: '2024-01-01T00:00:00Z',
      },
      loading: false,
    };

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(authedValue),
    });

    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.profile?.role).toBe('admin');
  });
});
