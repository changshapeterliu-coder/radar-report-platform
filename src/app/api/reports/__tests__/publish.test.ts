import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockUser: { id: string } | null = null;
let mockProfile: { role: string } | null = null;

const mockFromResults: Record<string, { data: unknown; error: unknown }> = {};

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
    if (table === 'profiles' && mockFromResults['profiles']) {
      return createChainableQuery(mockFromResults['profiles']);
    }
    if (table === 'profiles') {
      return createChainableQuery({ data: mockProfile, error: null });
    }
    if (mockFromResults[table]) {
      return createChainableQuery(mockFromResults[table]);
    }
    return createChainableQuery({ data: null, error: null });
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('PUT /api/reports/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockFromResults).forEach((k) => delete mockFromResults[k]);
  });

  it('should return 401 when not authenticated', async () => {
    setupAuth(null, null);
    setupFrom();

    const { PUT } = await import('@/app/api/reports/[id]/publish/route');
    const req = new NextRequest('http://localhost/api/reports/123/publish', { method: 'PUT' });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(401);
  });

  it('should return 403 when user is not admin', async () => {
    setupAuth({ id: 'user-1' }, { role: 'team_member' });
    setupFrom();

    const { PUT } = await import('@/app/api/reports/[id]/publish/route');
    const req = new NextRequest('http://localhost/api/reports/123/publish', { method: 'PUT' });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(403);
  });

  it('should publish report and create notifications', async () => {
    const publishedReport = {
      id: '123',
      title: 'Published Report',
      domain_id: 'domain-1',
      status: 'published',
    };
    const teamMembers = [{ id: 'member-1' }, { id: 'member-2' }];

    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockFromResults['reports'] = { data: publishedReport, error: null };

    // For the second call to profiles (team members query), we need special handling
    let profileCallCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        profileCallCount++;
        if (profileCallCount === 1) {
          // First call: role check
          return createChainableQuery({ data: { role: 'admin' }, error: null });
        }
        // Second call: team members
        return createChainableQuery({ data: teamMembers, error: null });
      }
      if (table === 'reports') {
        return createChainableQuery({ data: publishedReport, error: null });
      }
      if (table === 'notifications') {
        return createChainableQuery({ data: null, error: null });
      }
      return createChainableQuery({ data: null, error: null });
    });

    const { PUT } = await import('@/app/api/reports/[id]/publish/route');
    const req = new NextRequest('http://localhost/api/reports/123/publish', { method: 'PUT' });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('published');
  });

  it('should return 404 when report not found', async () => {
    setupAuth({ id: 'admin-1' }, { role: 'admin' });
    mockFromResults['reports'] = { data: null, error: { code: 'PGRST116', message: 'Not found' } };
    setupFrom();

    const { PUT } = await import('@/app/api/reports/[id]/publish/route');
    const req = new NextRequest('http://localhost/api/reports/123/publish', { method: 'PUT' });
    const res = await PUT(req, makeContext('123'));

    expect(res.status).toBe(404);
  });
});
