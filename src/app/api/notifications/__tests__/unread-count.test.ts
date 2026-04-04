import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockQueryResult: { data: unknown; error: unknown; count?: number | null } = { data: null, error: null, count: 0 };

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

function createChainableQuery(result: { data: unknown; error: unknown; count?: number | null }) {
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

describe('GET /api/notifications/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: null, error: null, count: 0 };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null);
    setupFrom();

    const { GET } = await import('../unread-count/route');
    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return unread count for authenticated user', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: null, count: 5 };
    setupFrom();

    const { GET } = await import('../unread-count/route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unreadCount).toBe(5);
  });

  it('should return 0 when no unread notifications', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: null, count: 0 };
    setupFrom();

    const { GET } = await import('../unread-count/route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unreadCount).toBe(0);
  });

  it('should handle null count as 0', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: null, count: null };
    setupFrom();

    const { GET } = await import('../unread-count/route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unreadCount).toBe(0);
  });

  it('should handle query errors', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: { message: 'DB error' }, count: null };
    setupFrom();

    const { GET } = await import('../unread-count/route');
    const res = await GET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_ERROR');
  });
});
