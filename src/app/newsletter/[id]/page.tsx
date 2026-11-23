'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function NewsletterDetailPage() {
  const router = useRouter();
  const [item, setItem] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      const id = window.location.pathname.split('/').pop();
      if (!id) return;

      const supabase = createClient();
      const { data } = await supabase
        .from('newsletters')
        .select('*')
        .eq('id', id)
        .single();

      if (data) setItem(data);
      setLoading(false);
    };

    fetchDetail();
  }, []);

  if (loading) return <div className="p-8 max-w-4xl mx-auto">불러오는 중...</div>;
  if (!item) return <div className="p-8 max-w-4xl mx-auto">뉴스레터를 찾을 수 없어.</div>;

  const title = item.title || item.subject || '제목 없음';
  const sender = item.sender_name || item.sender || '발행처 정보 없음';
  const brandColor = item.brand_color || '#262626';
  const htmlBody = item.content_html || item.html_content || item.html;
  const textBody = item.content || item.body || item.content_text || item.summary || '본문 내용이 없어.';

  return (
    <div className="p-8 max-w-4xl mx-auto bg-white min-h-screen">
      <button
        onClick={() => router.push('/newsletter')}
        className="mb-6 text-sm text-gray-500 hover:text-black"
      >
        ← 목록으로 돌아가기
      </button>

      <div className="mb-3">
        <span
          className="inline-block px-2.5 py-1 text-xs font-semibold text-white rounded"
          style={{ backgroundColor: brandColor }}
        >
          {sender}
        </span>
      </div>

      <h1 className="text-2xl font-bold mb-6 pb-4 border-b text-[#262626]">
        {title}
      </h1>

      {htmlBody ? (
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{ __html: htmlBody }}
        />
      ) : (
        <div className="whitespace-pre-wrap leading-relaxed text-[#262626]">
          {textBody}
        </div>
      )}
    </div>
  );
}