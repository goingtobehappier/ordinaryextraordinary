import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, sender_name, brand_color, summary, content } = body;

    if (!title || !content) {
      return NextResponse.json({ error: '제목과 본문은 필수야!' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.from('newsletters').insert([
      {
        title,
        sender_name: sender_name || '구독 뉴스레터',
        brand_color: brand_color || '#262626',
        summary: summary || title,
        content,
        received_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;

    return NextResponse.json({ success: true, message: '뉴스레터 저장 성공!' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}