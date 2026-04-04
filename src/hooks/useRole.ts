'use client';

import { useAuth } from './useAuth';

export function useRole() {
  const { profile, loading } = useAuth();

  return {
    role: profile?.role ?? null,
    isAdmin: profile?.role === 'admin',
    isTeamMember: profile?.role === 'team_member',
    loading,
  };
}
