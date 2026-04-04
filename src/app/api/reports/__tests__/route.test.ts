import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock chain builder for Supabase queries
function createMockChain(finalResult: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'ilike', 'order', 'range', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal: select with count returns the final result including count
  chain.select = vi.fn().mockImplementation(() => {
    // If finalResult has count, attach it
    const c = { ...chain, ...finalResult };
    return c;
  });
  // Override to always return chain for chaining, but resolve at the end
  for (const m of methods) {
    if (m !== 'select') {
      chain[m] = vi.fn().mockReturnValue({ ...chain, ...finalResult });
    }
  }
  return chain;
}

// Shared mock state
let mockUser: { id: string } | null = null;
let mockProfile: { role: string } | null = null;
let mockQueryResult: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };
let mockInsertResult: { data: unknown; error: unknown } = { data: null, error: null };

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

function setupFrom() {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return createChainableQuery({ data: mockProfile, error: null });
    }
    if (table === 'reports') {
      return createChainableQuery(mockQueryResult);
    }
    if (table === 'notifications') {
      return createChainableQuery({ data: null, error: null });
    }
    return createChainableQuery({ data: null, error: null });
  });
}

function createChainableQuery(result: { data: unknown; error: unknown; count?: number }) {
  const proxy: Record<string, unknown> = { ...result };
  const handler = {
    get(target: Record<string, unknown>, prop: string) {
      if (prop in result && typeof prop === 'string' && ['data', 'error', 'count'].includes(prop)) {
        return (result as Record<string, unknown>)[prop];
      }
      if (prop === 'then') return undefined; // Not a promise
      return vi.fn().mockReturnValue(new Proxy({ ...result }, handler));
    },
  };
  return new Proxy(proxy, handler);
}

describe('GET /api/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null, count: 0 };
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return reports for authenticated user', async () => {
    const reports = [{ id: '1', title: 'Test Report', status: 'published' }];
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    mockQueryResult = { data: reports, error: null, count: 1 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(reports);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(1);
  });

  it('should support pagination params', async () => {
    setupAuth({ id: 'user-1' }, { role: 'admin' });
    mockQueryResult = { data: [], error: null, count: 0 };
    setupFrom();

    const { GET } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports?page=2&limit=10');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(10);
  });
});

describe('POST /api/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports', {
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
    const req = new NextRequest('http://localhost/api/reports', {
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
    const req = new NextRequest('http://localhost/api/reports', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when content validation fails', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Report',
        type: 'regular',
        date_range: 'Jan 2026',
        domain_id: 'domain-1',
        content: { title: '', dateRange: '', modules: [] },
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('CONTENT_VALIDATION_ERROR');
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('should create report with valid data and return 201', async () => {
    const validContent = {
      title: 'Report Title',
      dateRange: 'Jan 2026',
      modules: [
        { title: 'M1', tables: [], analysisSections: [], highlightBoxes: [] },
        { title: 'M2', tables: [], analysisSections: [], highlightBoxes: [] },
        { title: 'M3', tables: [], analysisSections: [], highlightBoxes: [] },
        { title: 'M4', tables: [], analysisSections: [], highlightBoxes: [] },
      ],
    };
    const createdReport = { id: 'new-1', title: 'Test Report', content: validContent };

    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockQueryResult = { data: createdReport, error: null };
    setupFrom();

    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Test Report',
        type: 'regular',
        date_range: 'Jan 2026',
        domain_id: 'domain-1',
        content: validContent,
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
