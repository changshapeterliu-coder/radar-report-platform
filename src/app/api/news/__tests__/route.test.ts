import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockUser: { id: string } | null = null;
let mockProfile: { role: string } | null = null;
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

function setupAuth(user: { id: string } | null, profile: { role: string } | null) {
  mockUser = user;
  mockProfile = profile;
  if (user) {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  } else {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
  }
}

function createChainableQuery(result: { data: unknown; error: unknown; count?: number }) {
  const proxy: Record<string, unknown> = { ...result };
  const handler = {
    get(target: Record<string, unknown>, prop: string) {
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
    if (table === 'profiles') {
      return createChainableQuery({ data: mockProfile, error: null });
    }
    if (table === 'news') {
      return createChainableQuery(mockQueryResult);
    }
    return createChainableQuery({ data: null, error: null });
  });
}

describe('GET /api/news', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null, count: 0 };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/news');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return news list for authenticated user', async () => {
    const newsList = [
      { id: '1', title: 'News 1', is_pinned: true },
      { id: '2', title: 'News 2', is_pinned: false },
    ];
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: newsList, error: null, count: 2 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/news');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(newsList);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(2);
  });

  it('should support pagination params', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: [], error: null, count: 0 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/news?page=2&limit=10');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(10);
  });

  it('should handle query errors', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: null, error: { message: 'DB error' }, count: 0 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/news');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_ERROR');
  });
});

describe('POST /api/news', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/news', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('should return 403 when user is not admin', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/news', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('should return 400 when required fields are missing', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/news', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('content');
    expect(body.message).toContain('source_channel');
    expect(body.message).toContain('domain_id');
  });

  it('should create news with valid data and return 201', async () => {
    const createdNews = {
      id: 'news-1',
      title: 'Breaking News',
      content: 'Full content here',
      source_channel: '知无不言',
      domain_id: 'domain-1',
    };

    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: createdNews, error: null };
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/news', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Breaking News',
        content: 'Full content here',
        source_channel: '知无不言',
        domain_id: 'domain-1',
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it('should accept optional summary field', async () => {
    const createdNews = {
      id: 'news-1',
      title: 'Breaking News',
      content: 'Full content',
      source_channel: '36氪',
      domain_id: 'domain-1',
      summary: 'Short summary',
    };

    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: createdNews, error: null };
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/news', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Breaking News',
        content: 'Full content',
        source_channel: '36氪',
        domain_id: 'domain-1',
        summary: 'Short summary',
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
  });
});
