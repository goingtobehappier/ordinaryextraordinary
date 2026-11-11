/* ordinaryextraordinary service worker
 * - 앱 설치(홈 화면 추가) 지원
 * - 타임테이블 알림 표시 · 알림 클릭 시 앱 창으로 이동
 * 데이터는 로그인 세션 기반(Supabase)이라 페이지를 캐시하지 않음 (항상 네트워크)
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});
