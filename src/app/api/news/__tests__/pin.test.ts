import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockUser: { id: string } | null = null;
let mockProfile: { role: string } | null = null;
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

function setupAuth(user: { id: string } | null, profile: { role: string } | null) {
  mockUser = user;
  mockProfile = profile;
  if (user) {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  } else {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
  }
}

function createChainableQuery(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, unknown> = { ...result };
  const handler = {
    get(target: Record<string, unknown>, prop: string) {
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
    if (table === 'profiles') {
      return createChainableQuery({ data: mockProfile, error: null });
    }
    return createChainableQuery(mockQueryResult);
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('PUT /api/news/[id]/pin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: null, error: null };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/123/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: true }),
    });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(401);
  });

  it('should return 403 when user is not admin', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/123/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: true }),
    });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(403);
  });

  it('should return 400 when is_pinned is not a boolean', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/123/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: 'yes' }),
    });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('is_pinned');
  });

  it('should pin news successfully', async () => {
    const pinnedNews = { id: '123', title: 'News', is_pinned: true };
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: pinnedNews, error: null };
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/123/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: true }),
    });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(pinnedNews);
  });

  it('should unpin news successfully', async () => {
    const unpinnedNews = { id: '123', title: 'News', is_pinned: false };
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: unpinnedNews, error: null };
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/123/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: false }),
    });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.is_pinned).toBe(false);
  });

  it('should return 404 when news not found', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: null, error: { code: 'PGRST116', message: 'Not found' } };
    setupFrom();

    const { PUT } = await import('@/app/api/news/[id]/pin/route');
    const req = new NextRequest('http://localhost/api/news/nonexistent/pin', {
      method: 'PUT',
      body: JSON.stringify({ is_pinned: true }),
    });
    const res = await PUT(req, makeContext('nonexistent'));

    expect(res.status).toBe(404);
  });
});
