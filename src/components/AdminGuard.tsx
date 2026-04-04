'use client';

import type { ReactNode } from 'react';
import { useRole } from '@/hooks/useRole';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useRole();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">
            Access Denied
          </h2>
          <p className="text-gray-600">权限不足，您没有权限访问此页面。</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
