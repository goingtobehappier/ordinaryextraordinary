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

/* 백그라운드 알림: Supabase Edge Function(send-alarms)이 보낸 Web Push → OS 알림
 * 탭·창을 닫아도 브라우저가 서비스 워커를 깨워 이 핸들러를 실행함.
 * 앱이 열려 있어 같은 알림을 이미 띄웠다면 같은 tag라 교체만 됨 (중복 팝업 없음) */
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "업무 알림", {
      body: d.body || "",
      tag: d.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: d.url || "/" },
      // 정각 알림은 사용자가 닫을 때까지 유지 (지원 브라우저)
      requireInteraction: d.phase === "start",
    }),
  );
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
