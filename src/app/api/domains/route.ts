import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
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

  const { data, error } = await supabase
    .from('domains')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data });
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

  const { name, description } = body as {
    name?: string;
    description?: string;
  };

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Missing or invalid required field: name', statusCode: 400 },
      { status: 400 }
    );
  }

  const insertData: Record<string, unknown> = { name: name.trim() };
  if (description !== undefined) {
    insertData.description = description;
  }

  const { data, error } = await supabase
    .from('domains')
    .insert(insertData)
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
