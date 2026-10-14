/*
 * 한약 드실게요 — 서비스 워커
 * 1) 오프라인 실행: 앱 파일과 5초 영상을 미리 저장 (인터넷 없이 영상 재생)
 * 2) 알림 터치 처리: 해당 복용 회차 화면 열기 (영상은 알림 터치로 들어왔을 때만)
 * 서버 통신 없음. 이 파일은 개인 정보를 다루지 않습니다.
 */
'use strict';

const CACHE = 'hanyak-pwa-0.1.0';
const PRECACHE = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/badge-96.png',
  'icons/apple-touch-icon.png',
  'media/hanyak_intro.mp4',
  'media/poster.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hanyak-pwa-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 캐시된 영상에 대한 Range 요청 처리 (모바일 브라우저의 영상 재생은 부분 요청을 사용) */
async function rangeResponse(request, cached) {
  const range = request.headers.get('range');
  if (!range || !cached) return cached;
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return cached;
  const size = buf.byteLength;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  if (m[1] === '' && m[2] === '') { start = 0; end = size - 1; }
  if (start >= size || start < 0 || end < start) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 화면 이동: 주소 뒤 ?dose=… 등은 무시하고 캐시된 앱 화면 사용 (오프라인에서도 열림)
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }

  if (url.pathname.endsWith('.mp4')) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(url.pathname.slice(url.pathname.lastIndexOf('media/')), { ignoreSearch: true }) ||
          await c.match(req, { ignoreSearch: true });
        if (cached) return rangeResponse(req, cached);
        return fetch(req);
      })
    );
    return;
  }

  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});

/** 알림 터치 → 해당 회차 화면. 이미 열린 창이 있으면 그 창을 앞으로 가져와 회차 화면으로 전환 */
self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  const clickedAt = Date.now();
  n.close();

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = self.registration.scope;
    const mine = wins.filter((w) => w.url.startsWith(scope));
    if (mine.length) {
      const w = mine[0];
      try { await w.focus(); } catch (e) { /* noop */ }
      w.postMessage({ type: 'open', kind: data.kind, gen: data.gen, index: data.index, due: data.due, clickedAt });
      return;
    }
    const target = new URL(data.url || './', scope);
    target.searchParams.set('ct', String(clickedAt));
    await self.clients.openWindow(target.href);
  })());
});

/*
 * Web Push (현재 미사용 — 푸시 서버 승인 후 사용)
 * 서버가 {kind:'dose', gen, index, due} 를 보내면 앱의 로컬 알림과 같은 형태로 표시.
 * tag 가 같으므로 앱이 이미 띄운 알림과 겹쳐도 하나만 남고 다시 울리지 않음.
 */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  if (d.kind !== 'dose') return;
  event.waitUntil(self.registration.showNotification('한약 드실게요', {
    body: '처방된 한약을 드실 시간입니다',
    tag: `dose-${d.gen}-${d.index}`,
    renotify: false,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    vibrate: [300, 150, 300],
    timestamp: d.due,
    data: { kind: 'dose', gen: d.gen, index: d.index, due: d.due, url: `./?dose=${d.gen}.${d.index}&n=1` },
  }));
});
