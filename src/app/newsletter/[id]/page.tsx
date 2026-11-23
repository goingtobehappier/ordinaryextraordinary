'use client';

import { createClient } from '@/lib/supabase/client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type NewsletterDetail = {
  id: string;
  subject: string;
  sender: string;
  content_html?: string;
  content_text?: string;
  received_at?: string;
  created_at?: string;
};

export default function NewsletterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [item, setItem] = useState<NewsletterDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      if (!params?.id) return;
      const supabase = createClient();
      const { data } = await supabase
        .from('newsletters')
        .select('*')
        .eq('id', params.id)
        .single();

      if (data) setItem(data);
      setLoading(false);
    };

    fetchDetail();
  }, [params?.id]);

  if (loading) return <div className="p-8 max-w-4xl mx-auto">불러오는 중...</div>;
  if (!item) return <div className="p-8 max-w-4xl mx-auto">뉴스레터를 찾을 수 없어.</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto bg-white min-h-screen">
      <button
        onClick={() => router.push('/newsletter')}
        className="mb-6 text-sm text-gray-500 hover:text-black"
      >
        ← 목록으로 돌아가기
      </button>
      <h1 className="text-2xl font-bold mb-2 text-[#262626]">{item.subject}</h1>
      <div className="text-sm text-gray-500 mb-8 pb-4 border-b">
        보낸 사람: {item.sender}
      </div>
      {item.content_html ? (
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{ __html: item.content_html }}
        />
      ) : (
        <div className="whitespace-pre-wrap leading-relaxed text-[#262626]">
          {item.content_text}
        </div>
      )}
    </div>
  );
}