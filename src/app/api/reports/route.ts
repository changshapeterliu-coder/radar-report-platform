import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateReportContent } from '@/lib/validators/content-validator';
import type { ReportContent } from '@/types/report';

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  // Check if user is admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isAdmin = profile?.role === 'admin';

  const { searchParams } = request.nextUrl;
  const domainId = searchParams.get('domain_id');
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('reports')
    .select('*', { count: 'exact' });

  // Non-admin users can only see published reports
  if (!isAdmin) {
    query = query.eq('status', 'published');
  } else if (status) {
    query = query.eq('status', status);
  }

  if (domainId) {
    query = query.eq('domain_id', domainId);
  }

  if (type) {
    query = query.eq('type', type);
  }

  if (search) {
    query = query.ilike('title', `%${search}%`);
  }

  query = query.order('published_at', { ascending: false }).range(from, to);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
}


export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 },
      { status: 401 }
    );
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { title, type, date_range, domain_id, content } = body as {
    title?: string;
    type?: string;
    date_range?: string;
    domain_id?: string;
    content?: unknown;
  };

  // Validate required metadata fields
  const missingFields: string[] = [];
  if (!title || typeof title !== 'string' || title.trim() === '') missingFields.push('title');
  if (!type || (type !== 'regular' && type !== 'topic')) missingFields.push('type');
  if (!date_range || typeof date_range !== 'string' || date_range.trim() === '') missingFields.push('date_range');
  if (!domain_id || typeof domain_id !== 'string') missingFields.push('domain_id');

  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        message: `Missing or invalid required fields: ${missingFields.join(', ')}`,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  // Validate content using ContentValidator
  if (!content) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Content is required', statusCode: 400 },
      { status: 400 }
    );
  }

  const validationErrors = validateReportContent(content, type as 'regular' | 'topic');
  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        code: 'CONTENT_VALIDATION_ERROR',
        message: 'Report content validation failed',
        errors: validationErrors,
        statusCode: 400,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('reports')
    .insert({
      title: title!,
      type: type as 'regular' | 'topic',
      date_range: date_range!,
      domain_id: domain_id!,
      content: content as ReportContent,
      created_by: user.id,
      status: 'draft',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'INSERT_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}
