/*
 * 한약 드실게요 — 달력(.ics) 알림 시험판 화면
 * 공개 앱의 저장 데이터(hanyak.v1)는 '읽기'만 합니다. 쓰거나 지우지 않습니다.
 * 서비스 워커를 등록하지 않고, 외부로 아무것도 보내지 않습니다.
 * © 2026 SOCRA × TESS. All rights reserved.
 */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = { 1: [480], 2: [480, 1140], 3: [480, 780, 1140] };
  const APP_URL = new URL('../', location.href).href;       // 달력 일정 안의 앱 주소 (한의원 정보 등 매개변수 없음)
  const FILE = '한약복약알림.ics';
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const fmt = (dt) => { const w = new Date(dt.y, dt.m - 1, dt.d).getDay(); return `${dt.m}월 ${dt.d}일 (${WD[w]})`; };
  const ampm = (m) => { const h = Math.floor(m / 60); return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)}`; };

  const form = { count: 2, times: [480, 1140, 0] };

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function opts() {
    return { startDate: $('calStart').value, days: parseInt($('calDays').value, 10), times: form.times.slice(0, form.count), appUrl: APP_URL };
  }

  function render() {
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.count === form.count)));
    document.querySelectorAll('.time-row').forEach((row) => {
      const i = +row.dataset.i;
      row.hidden = i >= form.count;
      const inp = row.querySelector('input');
      if (inp.value !== hhmm(form.times[i])) inp.value = hhmm(form.times[i]);
    });
    let ok = false;
    try {
      const s = HanyakIcs.summary(opts());
      $('calSummary').textContent = `하루 ${s.perDay}회 × ${opts().days}일 = 총 ${s.total}회\n${fmt(s.first)} ~ ${fmt(s.last)}\n알림: ${s.times.map(ampm).join(' · ')} 정각`;
      ok = true;
    } catch (e) {
      $('calSummary').textContent = $('calDays').value ? e.message : '복용 기간을 입력하면 알림 횟수가 계산됩니다';
    }
    $('calMake').disabled = !(ok && $('calAgree').checked);
    $('calShare').disabled = $('calMake').disabled;
  }

  /** 공개 앱에 저장된 일정을 '읽기만' 해서 입력칸에 채움 */
  function savedSchedule() {
    try {
      const d = JSON.parse(localStorage.getItem('hanyak.v1') || 'null');
      const s = d && d.schedule;
      if (!s || !Array.isArray(s.times) || !(s.days > 0)) return null;
      const u = new Date(s.startEpochDay * 86400000);
      return { startDate: `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`, days: s.days, times: s.times };
    } catch (e) { return null; }
  }

  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function makeFile() {
    const text = HanyakIcs.buildIcs(opts(), new Date());
    return { text, blob: new Blob([text], { type: 'text/calendar;charset=utf-8' }) };
  }

  function download() {
    let f;
    try { f = makeFile(); } catch (e) { toast(e.message); return; }
    if (isIOS()) {
      // iPhone Safari: 달력 형식 주소로 열면 '캘린더에 추가' 화면이 뜨는 경우가 있음 (실측 필요)
      location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(f.text);
    } else {
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement('a');
      a.href = url; a.download = FILE; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    $('calAfter').hidden = false;
    window.__lastIcs = f.text;   // 자동 시험용 (화면에는 영향 없음)
  }

  async function share() {
    let f;
    try { f = makeFile(); } catch (e) { toast(e.message); return; }
    const file = new File([f.blob], FILE, { type: 'text/calendar' });
    try {
      await navigator.share({ files: [file], title: '🍵 복약 알림' });
      $('calAfter').hidden = false;
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('공유로 열 수 없어요. ‘폰 달력에 넣기’를 이용해 주세요');
    }
  }

  // 초기화
  $('calStart').value = today();
  const saved = savedSchedule();
  $('loadSaved').hidden = !saved;
  $('loadSaved').onclick = () => {
    const s = savedSchedule(); if (!s) return;
    $('calStart').value = s.startDate; $('calDays').value = String(s.days);
    form.count = s.times.length; form.times = s.times.concat([0, 0, 0]).slice(0, 3);
    render(); toast('앱에 저장된 일정을 불러왔어요');
  };
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    form.count = +b.dataset.count; form.times = DEFAULTS[form.count].concat([0, 0, 0]).slice(0, 3); render();
  }));
  document.querySelectorAll('.time-row input').forEach((inp) => inp.addEventListener('change', () => {
    const i = +inp.closest('.time-row').dataset.i;
    if (/^\d{2}:\d{2}$/.test(inp.value)) form.times[i] = +inp.value.slice(0, 2) * 60 + +inp.value.slice(3, 5);
    render();
  }));
  ['calStart', 'calDays'].forEach((id) => $(id).addEventListener('input', render));
  $('calAgree').addEventListener('change', render);
  $('calMake').onclick = download;
  try {
    const probe = new File(['x'], FILE, { type: 'text/calendar' });
    $('calShare').hidden = !(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch (e) { $('calShare').hidden = true; }
  $('calShare').onclick = share;
  render();
})();
