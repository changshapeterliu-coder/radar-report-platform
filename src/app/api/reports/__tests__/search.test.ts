import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Shared mock state
let mockUser: { id: string } | null = null;
let mockRpcResult: { data: unknown; error: unknown } = { data: [], error: null };

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => mockSupabase),
}));

function setupAuth(user: { id: string } | null) {
  mockUser = user;
  if (user) {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });
  } else {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } });
  }
}

describe('GET /api/reports/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = { data: [], error: null };
    mockSupabase.rpc.mockImplementation(() => Promise.resolve(mockRpcResult));
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null);

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=test&domain_id=d1');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return 400 when search query is missing', async () => {
    setupAuth({ id: 'user-1' });

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?domain_id=d1');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('q');
  });

  it('should return 400 when search query is empty', async () => {
    setupAuth({ id: 'user-1' });

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=&domain_id=d1');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 when domain_id is missing', async () => {
    setupAuth({ id: 'user-1' });

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=test');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('domain_id');
  });

  it('should call supabase.rpc with correct parameters', async () => {
    setupAuth({ id: 'user-1' });
    const mockReports = [
      { id: '1', title: 'Account Health Report', status: 'published' },
    ];
    mockRpcResult = { data: mockReports, error: null };
    mockSupabase.rpc.mockImplementation(() => Promise.resolve(mockRpcResult));

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=account&domain_id=domain-1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_reports', {
      search_query: 'account',
      domain_filter: 'domain-1',
    });
    const body = await res.json();
    expect(body.data).toEqual(mockReports);
  });

  it('should return empty array when no results found', async () => {
    setupAuth({ id: 'user-1' });
    mockRpcResult = { data: [], error: null };
    mockSupabase.rpc.mockImplementation(() => Promise.resolve(mockRpcResult));

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=nonexistent&domain_id=domain-1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('should return 500 when rpc call fails', async () => {
    setupAuth({ id: 'user-1' });
    mockRpcResult = { data: null, error: { message: 'Database error' } };
    mockSupabase.rpc.mockImplementation(() => Promise.resolve(mockRpcResult));

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=test&domain_id=domain-1');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('SEARCH_ERROR');
  });

  it('should trim whitespace from search query', async () => {
    setupAuth({ id: 'user-1' });
    mockRpcResult = { data: [], error: null };
    mockSupabase.rpc.mockImplementation(() => Promise.resolve(mockRpcResult));

    const { GET } = await import('../search/route');
    const req = new NextRequest('http://localhost/api/reports/search?q=%20account%20&domain_id=domain-1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_reports', {
      search_query: 'account',
      domain_filter: 'domain-1',
    });
  });
});
