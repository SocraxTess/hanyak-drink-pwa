// 달력 파일 생성 자동 테스트 — 실행: node calendar-test/tests/ics.test.js [출력폴더]
// 출력폴더를 주면 각 경우의 .ics 와 기대 알림 시각(.json)을 저장 → verify_ics.py 가 독립적으로 다시 검증
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ics = require('../ics.js');

const OUT = process.argv[2];
const NOW = new Date(Date.UTC(2026, 10, 3, 6, 0, 0));
const APP = 'https://socraxtess.github.io/hanyak-drink-pwa/';
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '—', e.message); }
}
const lines = (s) => s.split('\r\n').filter(Boolean);
const unfold = (s) => s.replace(/\r\n /g, '');

const CASES = {
  once_14d: { startDate: '2026-11-03', days: 14, times: [8 * 60], appUrl: APP },
  twice_14d: { startDate: '2026-11-03', days: 14, times: [19 * 60, 8 * 60], appUrl: APP },     // 순서 뒤섞어 입력
  thrice_7d: { startDate: '2026-11-03', days: 7, times: [8 * 60, 13 * 60, 19 * 60], appUrl: APP },
  midnight: { startDate: '2026-12-30', days: 4, times: [0, 23 * 60 + 55], appUrl: APP },     // 00:00, 23:55, 연도 넘김
  leapday: { startDate: '2028-02-27', days: 4, times: [9 * 60], appUrl: APP },                  // 2028-02-29 포함
  oneday: { startDate: '2026-11-03', days: 1, times: [7 * 60 + 30], appUrl: APP },
  year: { startDate: '2026-11-03', days: 365, times: [8 * 60, 20 * 60], appUrl: APP },
};

for (const [name, opt] of Object.entries(CASES)) {
  const out = ics.buildIcs(opt, NOW);
  t(`${name}: CRLF 줄바꿈, 75바이트 이하`, () => {
    assert.ok(out.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(out), 'LF 단독 줄바꿈 있음');
    out.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `75바이트 초과: ${l}`));
  });
  const u = lines(unfold(out));
  t(`${name}: 일정 수 = 하루 횟수, 알림 = 정각`, () => {
    assert.strictEqual(u.filter((l) => l === 'BEGIN:VEVENT').length, opt.times.length);
    assert.strictEqual(u.filter((l) => l === 'TRIGGER:PT0M').length, opt.times.length);
    assert.ok(!u.some((l) => /^TRIGGER:-/.test(l)), '사전 알림이 들어가 있음');
    assert.strictEqual(u.filter((l) => l === `RRULE:FREQ=DAILY;COUNT=${opt.days}`).length, opt.times.length);
  });
  t(`${name}: 서울 시간대, UTC 서명 시각`, () => {
    assert.ok(u.includes('TZID:Asia/Seoul') && u.includes('TZOFFSETTO:+0900'));
    assert.ok(u.filter((l) => l.startsWith('DTSTART;TZID=Asia/Seoul:')).length === opt.times.length);
    assert.ok(u.filter((l) => l.startsWith('DTSTAMP:')).every((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)));
  });
  t(`${name}: 개인정보 없음 (제목·설명은 복약 안내와 앱 주소만)`, () => {
    const text = u.filter((l) => /^(SUMMARY|DESCRIPTION|URL|X-WR-CALNAME)/.test(l)).join('\n');
    assert.ok(!/\d{2,3}-\d{3,4}-\d{4}/.test(text), '전화번호 형식 발견');
    assert.ok(u.filter((l) => l.startsWith('SUMMARY:')).every((l) => l === 'SUMMARY:🍵 복약 알림'));
  });
  t(`${name}: UID 고유·재생성 시 동일 (중복 등록 판별용)`, () => {
    const uids = u.filter((l) => l.startsWith('UID:'));
    assert.strictEqual(new Set(uids).size, uids.length);
    const again = lines(unfold(ics.buildIcs(opt, new Date()))).filter((l) => l.startsWith('UID:'));
    assert.deepStrictEqual(again, uids);
  });
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${name}.ics`), out);
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(ics.occurrences(opt)));
  }
}

t('요약: 종료일·총 횟수 (윤일 포함)', () => {
  const s = ics.summary(CASES.leapday);
  assert.deepStrictEqual(s.last, { y: 2028, m: 3, d: 1 });
  assert.strictEqual(s.total, 4);
  assert.deepStrictEqual(ics.occurrences(CASES.leapday), ['2028-02-27 09:00', '2028-02-28 09:00', '2028-02-29 09:00', '2028-03-01 09:00']);
  assert.deepStrictEqual(ics.summary(CASES.year).last, { y: 2027, m: 11, d: 2 });
  assert.strictEqual(ics.summary(CASES.twice_14d).total, 28);
});
t('자정 경계: 00:00 과 23:55 모두 같은 날짜에 시작', () => {
  const occ = ics.occurrences(CASES.midnight);
  assert.deepStrictEqual(occ.slice(0, 4), ['2026-12-30 00:00', '2026-12-30 23:55', '2026-12-31 00:00', '2026-12-31 23:55']);
  assert.strictEqual(occ[occ.length - 1], '2027-01-02 23:55');
});
t('입력 검증: 잘못된 값은 파일을 만들지 않음', () => {
  const bad = [
    { startDate: '2026-02-30', days: 3, times: [480] },
    { startDate: '2026-11-03', days: 0, times: [480] },
    { startDate: '2026-11-03', days: 366, times: [480] },
    { startDate: '2026-11-03', days: 3, times: [] },
    { startDate: '2026-11-03', days: 3, times: [480, 600, 700, 800] },
    { startDate: '2026-11-03', days: 3, times: [480, 480] },
    { startDate: '2026-11-03', days: 3, times: [1440] },
  ];
  bad.forEach((b) => assert.throws(() => ics.buildIcs(b, NOW)));
});
t('텍스트 이스케이프', () => {
  assert.strictEqual(ics.esc('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});
t('줄 접기: 한글을 글자 중간에서 자르지 않음', () => {
  const long = 'DESCRIPTION:' + '한약'.repeat(40);
  const f = ics.fold(long);
  f.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75));
  assert.strictEqual(f.replace(/\r\n /g, ''), long);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
