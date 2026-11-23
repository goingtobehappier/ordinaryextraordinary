'use client';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type NewsletterDetail = {
  id: string;
  title: string;
  sender_name: string;
  brand_color: string;
  summary: string;
  content: string;
  received_at: string;
};

export default function NewsletterDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [letter, setLetter] = useState<NewsletterDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDetailAndMarkRead() {
      if (!id) return;

      const { data, error } = await supabase
        .from('newsletters')
        .select('*')
        .eq('id', id)
        .single();

      if (!error && data) {
        setLetter(data);

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('user_newsletter_states').upsert(
            {
              user_id: user.id,
              newsletter_id: id,
              is_read: true,
              read_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,newsletter_id' }
          );
        }
      }
      setLoading(false);
    }

    fetchDetailAndMarkRead();
  }, [id, supabase]);

  if (loading) return <div className="p-8 text-center text-gray-500">레터를 펼치는 중...</div>;
  if (!letter) return <div className="p-8 text-center text-gray-500">뉴스레터를 찾을 수 없어.</div>;

  return (
    <div className="max-w-3xl mx-auto px-5 py-12 bg-white min-h-screen">
      <button
        onClick={() => router.push('/newsletter')}
        className="text-sm text-gray-500 hover:text-[#262626] mb-8 flex items-center gap-1"
      >
        ← 아카이브 목록으로 돌아가기
      </button>

      <header
        className="pb-6 mb-8 border-b"
        style={{ borderBottomColor: letter.brand_color || '#262626' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span
            className="text-xs font-bold px-3 py-1 rounded-full text-white"
            style={{ backgroundColor: letter.brand_color || '#262626' }}
          >
            {letter.sender_name}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(letter.received_at).toLocaleDateString()}
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-[#262626] leading-snug">
          {letter.title}
        </h1>
      </header>

      {letter.summary && (
        <div className="bg-[#FAF9F6] border border-gray-200 rounded-xl p-5 mb-8">
          <p className="text-xs font-bold text-[#FF5722] mb-1.5">✨ AI 핵심 요약</p>
          <p className="text-sm text-[#262626] leading-relaxed">{letter.summary}</p>
        </div>
      )}

      <article className="prose prose-gray max-w-none text-[#262626] leading-relaxed whitespace-pre-wrap">
        {letter.content}
      </article>
    </div>
  );
}