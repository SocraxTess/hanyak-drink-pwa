/*
 * 한약 드실게요 — 달력(.ics) 알림 파일 생성 로직 (공개 앱)
 * 환자 기기의 브라우저 안에서만 파일을 만듭니다. 서버로 보내는 것은 없습니다.
 * 일정에는 복용 안내와 앱 주소만 넣습니다 (이름·진단·처방·전화번호 없음).
 * © 2026 SOCRA × TESS. All rights reserved.
 */
(function (root) {
  'use strict';

  const TZID = 'Asia/Seoul';
  const SUMMARY = '🍵 복약 알림';
  const BODY = '처방된 한약을 드실 시간입니다.';
  const DURATION = 'PT10M';

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /** 'YYYY-MM-DD' → {y,m,d} (검증 포함) */
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) throw new Error('시작일 형식이 올바르지 않습니다');
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error('없는 날짜입니다');
    return { y, m: mo, d };
  }

  /** 날짜에 n일 더하기 (달력 계산만, 시간대 영향 없음) */
  function addDays(date, n) {
    const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  const ymd = (dt) => `${dt.y}${pad(dt.m)}${pad(dt.d)}`;
  const hhmm = (min) => `${pad(Math.floor(min / 60))}${pad(min % 60)}`;

  /** 입력 검증 + 정리 (시각은 오름차순, 중복 금지) */
  function normalize(opts) {
    const start = parseDate(opts.startDate);
    const days = Number(opts.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('복용 기간은 1~365일입니다');
    const times = (opts.times || []).map(Number);
    if (times.length < 1 || times.length > 3) throw new Error('하루 복용 횟수는 1~3회입니다');
    times.forEach((t) => { if (!Number.isInteger(t) || t < 0 || t >= 1440) throw new Error('복용 시각이 올바르지 않습니다'); });
    const sorted = times.slice().sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) throw new Error('같은 복용 시각이 있습니다');
    return { start, days, times: sorted, appUrl: String(opts.appUrl || '') };
  }

  /** RFC 5545 텍스트 이스케이프 */
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /** 한 줄 75바이트 접기 (UTF-8 글자를 중간에서 자르지 않음) */
  function fold(line) {
    const enc = (s) => new TextEncoder().encode(s).length;
    if (enc(line) <= 75) return line;
    const out = [];
    let cur = '', limit = 75;
    for (const ch of line) {
      if (enc(cur + ch) > limit) { out.push(cur); cur = ch; limit = 74; } // 이어지는 줄은 앞의 공백 1바이트 포함
      else cur += ch;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  function utcStamp(now) {
    const d = now instanceof Date ? now : new Date();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  /**
   * 달력 파일 만들기.
   * 복용 시각마다 일정 1개 = "매일 반복, 복용 기간(일)만큼" + 정각 알림 1개.
   * UID 가 시작일·시각·기간으로 정해지므로, 같은 일정을 다시 넣으면 같은 UID 가 됩니다
   * (달력 앱이 UID 로 중복을 걸러 주는지는 기기마다 달라 실측 대상).
   */
  function buildIcs(opts, now) {
    const o = normalize(opts);
    const stamp = utcStamp(now);
    const desc = o.appUrl ? `${BODY}\n앱 열기: ${o.appUrl}` : BODY;
    const L = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SOCRA x TESS//Hanyak Drink Calendar Test 0.1//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:한약 복약 알림',
      `X-WR-TIMEZONE:${TZID}`,
      'BEGIN:VTIMEZONE',
      `TZID:${TZID}`,
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:KST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
    o.times.forEach((t) => {
      L.push(
        'BEGIN:VEVENT',
        `UID:hanyak-${ymd(o.start)}-${hhmm(t)}-${o.days}d@socraxtess.github.io`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${ymd(o.start)}T${hhmm(t)}00`,
        `DURATION:${DURATION}`,
        `RRULE:FREQ=DAILY;COUNT=${o.days}`,
        `SUMMARY:${esc(SUMMARY)}`,
        `DESCRIPTION:${esc(desc)}`,
      );
      if (o.appUrl) L.push(`URL:${o.appUrl}`);
      L.push(
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${esc(SUMMARY)}`,
        'TRIGGER:PT0M',            // 정각 알림 (사전 알림 없음)
        'END:VALARM',
        'END:VEVENT',
      );
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /** 화면 요약용: 첫·마지막 복용 날짜, 총 횟수 */
  function summary(opts) {
    const o = normalize(opts);
    return { first: o.start, last: addDays(o.start, o.days - 1), perDay: o.times.length, total: o.times.length * o.days, times: o.times };
  }

  /** 시험용: 파일이 만들어 낼 모든 알림 시각(서울 기준 'YYYY-MM-DD HH:MM') */
  function occurrences(opts) {
    const o = normalize(opts);
    const out = [];
    for (let i = 0; i < o.days; i++) {
      const d = addDays(o.start, i);
      o.times.forEach((t) => out.push(`${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(Math.floor(t / 60))}:${pad(t % 60)}`));
    }
    return out;
  }

  const api = { buildIcs, summary, occurrences, normalize, fold, esc, addDays, parseDate, SUMMARY, TZID };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HanyakIcs = api;
})(typeof self !== 'undefined' ? self : this);
