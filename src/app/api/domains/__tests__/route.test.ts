import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockProfile: { role: string } | null = null;
let mockQueryResult: { data: unknown; error: unknown; count?: number } = { data: [], error: null };

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
    if (table === 'profiles') {
      return createChainableQuery({ data: mockProfile, error: null });
    }
    if (table === 'domains') {
      return createChainableQuery(mockQueryResult);
    }
    return createChainableQuery({ data: null, error: null });
  });
}

describe('GET /api/domains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return domain list for authenticated user', async () => {
    const domains = [
      { id: 'd1', name: 'Account Health', description: null },
      { id: 'd2', name: 'Compliance', description: 'Compliance domain' },
    ];
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: domains, error: null };
    setupFrom();

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(domains);
  });

  it('should handle query errors', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: null, error: { message: 'DB error' } };
    setupFrom();

    const { GET } = await import('../route');
    const res = await GET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('QUERY_ERROR');
  });
});

describe('POST /api/domains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
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
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Domain' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('should return 400 when name is missing', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('name');
  });

  it('should return 400 when name is empty string', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: JSON.stringify({ name: '  ' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should create domain with valid name and return 201', async () => {
    const createdDomain = { id: 'domain-1', name: 'Compliance', description: null };
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: createdDomain, error: null };
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: JSON.stringify({ name: 'Compliance' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it('should accept optional description field', async () => {
    const createdDomain = { id: 'domain-1', name: 'Compliance', description: 'Compliance domain' };
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: createdDomain, error: null };
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: JSON.stringify({ name: 'Compliance', description: 'Compliance domain' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
  });

  it('should return 400 for invalid JSON body', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/domains', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_JSON');
  });
});
