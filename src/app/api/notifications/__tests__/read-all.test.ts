import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockQueryResult: { data: unknown; error: unknown } = { data: [], error: null };

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

function createChainableQuery(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, unknown> = { ...result };
  const handler = {
    get(_target: Record<string, unknown>, prop: string) {
      if (['data', 'error'].includes(prop)) {
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

describe('PUT /api/notifications/read-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null);
    setupFrom();

    const { PUT } = await import('../read-all/route');
    const res = await PUT();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should mark all notifications as read', async () => {
    const updatedNotifications = [
      { id: 'n1', is_read: true },
      { id: 'n2', is_read: true },
    ];
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: updatedNotifications, error: null };
    setupFrom();

    const { PUT } = await import('../read-all/route');
    const res = await PUT();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(updatedNotifications);
    expect(body.message).toBe('All notifications marked as read');
  });

  it('should handle empty result when no unread notifications', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: [], error: null };
    setupFrom();

    const { PUT } = await import('../read-all/route');
    const res = await PUT();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('should handle update errors', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: { message: 'DB error' } };
    setupFrom();

    const { PUT } = await import('../read-all/route');
    const res = await PUT();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('UPDATE_ERROR');
  });
});
