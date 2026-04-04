import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  const { searchParams } = request.nextUrl;
  const query = searchParams.get('q');
  const domainId = searchParams.get('domain_id');

  if (!query || query.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Search query (q) is required', statusCode: 400 },
      { status: 400 }
    );
  }

  if (!domainId) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'domain_id is required', statusCode: 400 },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc('search_reports', {
    search_query: query.trim(),
    domain_filter: domainId,
  });

  if (error) {
    return NextResponse.json(
      { code: 'SEARCH_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: data ?? [] });
}
