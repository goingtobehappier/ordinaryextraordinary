# send-alarms — 탭을 닫아도 오는 업무 시작 알림 (무료)

구조: **Supabase Cron(매분)** → **Edge Function `send-alarms`** → **Web Push** → 브라우저 서비스 워커(`public/sw.js`) → OS 알림

Supabase 무료 플랜 범위 안에서 동작합니다 (매분 호출 ≈ 월 4.3만 회, 무료 한도 50만 회).

## 1회 설정

1. **VAPID 키 생성** (아무 PC에서)
   ```bash
   npx web-push generate-vapid-keys
   ```
   - Public Key / Private Key 두 값이 나옵니다. Private Key는 어디에도 커밋하지 마세요.

2. **Edge Function 시크릿 등록 + 배포** (Supabase CLI, 프로젝트 루트에서)
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase secrets set VAPID_PUBLIC_KEY=<Public Key> VAPID_PRIVATE_KEY=<Private Key> VAPID_SUBJECT=mailto:<연락 이메일> ALARM_CRON_SECRET=<임의의 긴 문자열>
   supabase functions deploy send-alarms --no-verify-jwt
   ```
   - `--no-verify-jwt`: Cron이 `x-cron-secret` 헤더로 인증하므로 JWT 검사를 끕니다 (시크릿이 다르면 401).

3. **DB 마이그레이션 + Cron 시크릿** (Supabase SQL Editor)
   - `supabase/migrations/011_push_alarms.sql` 실행
   - 이어서:
     ```sql
     select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
     select vault.create_secret('<2번의 ALARM_CRON_SECRET과 같은 값>', 'alarm_cron_secret');
     ```

4. **웹앱 환경 변수** (Vercel 등 배포 환경 + 로컬 `.env.local`)
   ```
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<Public Key>
   ```
   - 설정 후 재배포. 이 값이 없으면 앱은 기존처럼 '탭이 열려 있을 때만' 알림을 띄웁니다.

5. 앱에서 타임블록 툴바의 🔔 알림을 켜고 권한을 허용하면 이 기기가 등록됩니다 (기기마다 1회).

## 확인

- SQL: `select * from public.push_subscriptions;` → 기기 행이 있어야 함
- SQL: `select * from cron.job_run_details order by start_time desc limit 5;` → 매분 succeeded
- Dashboard → Edge Functions → send-alarms → Logs: `{"sent":0}` 등 응답

## 알아둘 점

- **PC(Windows/macOS)**: 탭·창을 닫아도 브라우저 프로세스가 살아 있으면 도착합니다.
  Chrome을 완전히 종료한 상태에서도 받으려면 설정 → 시스템 → "Chrome을 닫아도 백그라운드 앱 계속 실행"을 켜 두세요.
- **Android**: Chrome 또는 설치한 앱(PWA) 모두 도착합니다.
- **iPhone/iPad**: iOS 16.4 이상에서 **홈 화면에 추가한 앱**으로 열어 알림을 켠 경우에만 도착합니다.
- 알림 끄기·로그아웃하면 그 기기의 구독이 해제됩니다.
- 앱이 열려 있으면 앱 자체 알림과 푸시가 같은 tag라 하나로 합쳐집니다 (중복 팝업 없음).
