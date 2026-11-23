'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Newsletter = {
  id: string;
  title: string;
  sender_name: string;
  brand_color: string;
  summary: string;
  received_at: string;
  is_read?: boolean;
};

export default function NewsletterPage() {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function fetchNewsletters() {
      const { data, error } = await supabase
        .from('newsletters')
        .select(`
          *,
          user_newsletter_states(is_read)
        `)
        .order('received_at', { ascending: false });

      if (!error && data) {
        const formatted = data.map((item: any) => ({
          ...item,
          is_read: item.user_newsletter_states?.[0]?.is_read || false,
        }));
        setNewsletters(formatted);
      }
      setLoading(false);
    }

    fetchNewsletters();
  }, [supabase]);

  if (loading) return <div className="p-8 text-center text-gray-500">뉴스레터 서재를 불러오는 중...</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">나만의 뉴스레터 아카이브</h1>
        <p className="text-sm text-gray-500 mt-1">발행처 고유의 감성과 컬러로 정리된 뉴스레터 서재</p>
      </header>

      {newsletters.length === 0 ? (
        <div className="text-center py-20 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500 text-sm">
          아직 도착한 뉴스레터가 없어. 테스트 데이터를 넣어보자!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {newsletters.map((letter) => {
            const brandColor = letter.brand_color || '#ffffff';
            // 배경색이 밝은지 어두운지에 따라 기본 글자색 조정 (원하면 커스텀 가능)
            const isRead = letter.is_read;

            return (
              <div
                key={letter.id}
                onClick={() => router.push(`/newsletter/${letter.id}`)}
                className={`cursor-pointer rounded-xl p-6 transition-all duration-300 shadow-sm hover:shadow-md flex flex-col justify-between ${
                  isRead ? 'opacity-50 grayscale' : 'hover:opacity-95'
                }`}
                style={{
                  backgroundColor: brandColor,
                  color: '#ffffff', // 전체 배경색이 들어가므로 기본 텍스트는 화이트톤으로 가독성 확보
                }}
              >
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-black/20 text-white backdrop-blur-sm">
                      {letter.sender_name}
                    </span>
                    <span className="text-xs opacity-80">
                      {new Date(letter.received_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold mb-2 line-clamp-2">
                    {letter.title}
                  </h2>
                  <p className="text-sm opacity-90 line-clamp-3 mb-4">
                    {letter.summary || 'AI 요약 준비 중...'}
                  </p>
                </div>

                <div className="pt-4 border-t border-white/20 flex justify-between items-center text-xs opacity-90">
                  <span>{isRead ? '✓ 읽음 완료' : '● 안 읽음'}</span>
                  <span className="font-medium">→ 읽어보기</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}