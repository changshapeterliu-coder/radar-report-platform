import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockQueryResult: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => mockSupabase),
}));

function setupAuth(user: { id: string } | null) {
  if (user) {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  } else {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
  }
}

function createChainableQuery(result: { data: unknown; error: unknown; count?: number }) {
  const proxy: Record<string, unknown> = { ...result };
  const handler = {
    get(_target: Record<string, unknown>, prop: string) {
      if (['data', 'error', 'count'].includes(prop)) {
        return (result as Record<string, unknown>)[prop];
      }
      if (prop === 'then') return undefined;
      return vi.fn().mockReturnValue(new Proxy({ ...result }, handler));
    },
  };
  return new Proxy(proxy, handler);
}

function setupFrom() {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'notifications') {
      return createChainableQuery(mockQueryResult);
    }
    return createChainableQuery({ data: null, error: null });
  });
}

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null, count: 0 };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null);
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/notifications');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return notifications for authenticated user', async () => {
    const notifications = [
      { id: 'n1', title: 'New report', type: 'report', is_read: false },
      { id: 'n2', title: 'New news', type: 'news', is_read: true },
    ];
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: notifications, error: null, count: 2 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/notifications');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(notifications);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(2);
  });

  it('should support pagination params', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: [], error: null, count: 0 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/notifications?page=3&limit=5');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(3);
    expect(body.pagination.limit).toBe(5);
  });

  it('should handle query errors', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: { message: 'DB error' }, count: 0 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/notifications');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_ERROR');
  });
});
