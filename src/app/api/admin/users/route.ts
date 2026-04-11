import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/users — List all users (profiles)
 * POST /api/admin/users — Create a new user via Supabase Admin API
 * 
 * NOTE: Requires SUPABASE_SERVICE_ROLE_KEY env var for user creation.
 * Found in Supabase Dashboard → Settings → API → service_role key.
 * Add it to your Vercel environment variables.
 */

async function verifyAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return null;
  return user;
}

export async function GET() {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);

  if (!admin) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin access required', statusCode: 403 },
      { status: 403 }
    );
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { code: 'QUERY_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: profiles });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);

  if (!admin) {
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

  const { email, password, role } = body as {
    email?: string;
    password?: string;
    role?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Email and password are required', statusCode: 400 },
      { status: 400 }
    );
  }

  const validRoles = ['team_member', 'admin'];
  const userRole = validRoles.includes(role ?? '') ? role : 'team_member';

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { code: 'CONFIG_ERROR', message: 'SUPABASE_SERVICE_ROLE_KEY is not configured', statusCode: 500 },
      { status: 500 }
    );
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    console.error('[Admin Users] createUser error:', createError.message, createError);
    return NextResponse.json(
      { code: 'CREATE_ERROR', message: createError.message, statusCode: 500 },
      { status: 500 }
    );
  }

  if (!newUser?.user) {
    return NextResponse.json(
      { code: 'CREATE_ERROR', message: 'User creation returned no user object', statusCode: 500 },
      { status: 500 }
    );
  }

  // Double-check: if email_confirmed_at is not set, force-confirm it
  if (!newUser.user.email_confirmed_at) {
    console.warn('[Admin Users] email_confirmed_at not set after creation, forcing confirmation...');
    const { error: updateError } = await adminSupabase.auth.admin.updateUser(
      newUser.user.id,
      { email_confirm: true }
    );
    if (updateError) {
      console.error('[Admin Users] Failed to force-confirm email:', updateError.message);
    }
  }

  // Update the profile with role and email (the trigger creates a default profile)
  await adminSupabase
    .from('profiles')
    .update({ role: userRole, email })
    .eq('id', newUser.user.id);

  return NextResponse.json({
    data: newUser.user,
    emailConfirmed: !!newUser.user.email_confirmed_at,
  }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const admin = await verifyAdmin(supabase);

  if (!admin) {
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

  const { userId, role } = body as { userId?: string; role?: string };

  if (!userId || !role) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'userId and role are required', statusCode: 400 },
      { status: 400 }
    );
  }

  const validRoles = ['team_member', 'admin'];
  if (!validRoles.includes(role)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Role must be team_member or admin', statusCode: 400 },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  if (error) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: error.message, statusCode: 500 },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: 'Role updated successfully' });
}
