import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';

const resend = new Resend(process.env.RESEND_API_KEY);

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: 'INVALID_JSON', message: 'Invalid JSON body', statusCode: 400 },
      { status: 400 }
    );
  }

  const { topic, description, requesterEmail, requesterName } = body as {
    topic?: string;
    description?: string;
    requesterEmail?: string;
    requesterName?: string;
  };

  if (!topic || typeof topic !== 'string' || topic.trim() === '') {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Topic is required', statusCode: 400 },
      { status: 400 }
    );
  }

  try {
    await resend.emails.send({
      from: 'Radar Report Platform <onboarding@resend.dev>',
      to: process.env.ADMIN_EMAIL || 'chenliua@amazon.com',
      subject: `[Report Request] ${topic}`,
      html: `<h2>New Report Topic Request</h2>
        <p><strong>Topic:</strong> ${topic}</p>
        <p><strong>Description:</strong> ${description || 'N/A'}</p>
        <p><strong>Requested by:</strong> ${requesterName || 'Unknown'} (${requesterEmail || 'N/A'})</p>
        <p><strong>Submitted at:</strong> ${new Date().toISOString()}</p>`,
    });

    return NextResponse.json({ message: 'Request submitted successfully' });
  } catch (error) {
    console.error('Failed to send request email:', error);
    return NextResponse.json(
      { code: 'EMAIL_ERROR', message: 'Failed to send request email', statusCode: 500 },
      { status: 500 }
    );
  }
}
