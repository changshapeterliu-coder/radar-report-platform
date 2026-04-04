'use client';

import { AdminGuard } from '@/components/AdminGuard';

export default function AdminPage() {
  return (
    <AdminGuard>
      <div>
        <h1 className="text-2xl font-bold text-[#232f3e]">Admin Panel</h1>
        <p className="mt-2 text-gray-500">Admin panel will be implemented in a later task.</p>
      </div>
    </AdminGuard>
  );
}
