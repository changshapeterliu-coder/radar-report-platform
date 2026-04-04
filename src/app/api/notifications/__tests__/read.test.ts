import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockQueryResult: { data: unknown; error: unknown } = { data: null, error: null };

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

describe('PUT /api/notifications/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: null, error: null };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null);
    setupFrom();

    const { PUT } = await import('../[id]/read/route');
    const req = new NextRequest('http://localhost/api/notifications/n1/read', { method: 'PUT' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'n1' }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should mark notification as read', async () => {
    const updatedNotification = { id: 'n1', title: 'Test', is_read: true };
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: updatedNotification, error: null };
    setupFrom();

    const { PUT } = await import('../[id]/read/route');
    const req = new NextRequest('http://localhost/api/notifications/n1/read', { method: 'PUT' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'n1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(updatedNotification);
  });

  it('should return 404 when notification not found', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: { code: 'PGRST116', message: 'Not found' } };
    setupFrom();

    const { PUT } = await import('../[id]/read/route');
    const req = new NextRequest('http://localhost/api/notifications/nonexistent/read', { method: 'PUT' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('should handle update errors', async () => {
    setupAuth({ id: 'user-1' });
    mockQueryResult = { data: null, error: { code: 'OTHER', message: 'DB error' } };
    setupFrom();

    const { PUT } = await import('../[id]/read/route');
    const req = new NextRequest('http://localhost/api/notifications/n1/read', { method: 'PUT' });
    const res = await PUT(req, { params: Promise.resolve({ id: 'n1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('UPDATE_ERROR');
  });
});
