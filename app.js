/*
 * 한약 드실게요 — PWA (APK v1.0.2 동작 이식)
 * 모든 데이터는 이 기기의 브라우저 저장소(localStorage)에만 저장합니다. 서버 전송 없음.
 * © 2026 Socra × Tess
 */
'use strict';

const APP_VERSION = 'pwa-0.1.0';
const KEY = 'hanyak.v1';
const NOTIFY_GRACE_MS = 10 * 60 * 1000;   // 예정 시각 후 10분 안에만 알림 (그 이후는 화면에서 '지금 드실 한약' 표시)
const PREPARE_TIMEOUT_MS = 10000;          // 영상이 준비되지 않으면 복용 확인으로 넘어감 (APK 동일)
const LOG_MAX = 60;

const $ = (id) => document.getElementById(id);

/* ───────────── 저장소 (APK Store.kt) ───────────── */
const Store = {
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({ clinicName: '', clinicPhone: '', gen: 0, schedule: null, done: [], notified: null, log: [] }, d);
    } catch (e) {
      return { clinicName: '', clinicPhone: '', gen: 0, schedule: null, done: [], notified: null, log: [] };
    }
  },
  save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 공간에 저장하지 못했어요'); }
  },
  update(fn) { const d = Store.load(); fn(d); Store.save(d); return d; },

  hasClinic() { const d = Store.load(); return d.clinicName.trim() !== '' && d.clinicPhone.trim() !== ''; },
  saveClinic(name, phone) { Store.update((d) => { d.clinicName = name.trim(); d.clinicPhone = phone.trim(); }); },

  schedule() {
    const s = Store.load().schedule;
    if (!s || !Array.isArray(s.times) || s.times.length < 1 || s.times.length > 3 || !(s.days > 0)) return null;
    return new Schedule(s.gen, s.times, s.startEpochDay, s.days);
  },
  /** 새 일정 저장. 이전 완료 기록·알림 기록 삭제. 한의원 정보 유지. */
  saveSchedule(times, startEpochDay, days) {
    let sch;
    Store.update((d) => {
      d.gen = (d.gen || 0) + 1;
      d.schedule = { gen: d.gen, times: times.slice().sort((a, b) => a - b), startEpochDay, days };
      d.done = [];
      d.notified = null;
      sch = d.schedule;
    });
    return sch;
  },
  /** 새 복용 시작: 일정·완료 기록·알림 기록만 초기화. 한의원 정보 유지. gen 증가로 이전 알림 무효화. */
  clearSchedule() {
    Store.update((d) => { d.gen = (d.gen || 0) + 1; d.schedule = null; d.done = []; d.notified = null; });
  },
  completed() { return new Set(Store.load().done); },
  isCompleted(i) { return Store.completed().has(i); },
  /** 회차 완료. 이미 완료면 false (중복 완료 처리 없음) */
  markCompleted(gen, i) {
    const s = Store.schedule();
    if (!s || s.gen !== gen || !s.isValidIndex(i)) return false;
    let added = false;
    Store.update((d) => { if (!d.done.includes(i)) { d.done.push(i); added = true; } });
    return added;
  },
  lastNotified(gen) { const n = Store.load().notified; return n && n.gen === gen ? n.index : -1; },
  /** 회차 알림 기록. 이미 그 회차(또는 뒤 회차)를 알렸다면 false → 같은 회차는 한 번만 알림 */
  markNotified(gen, i) {
    if (i <= Store.lastNotified(gen)) return false;
    Store.update((d) => { d.notified = { gen, index: i }; });
    return true;
  },
  log(entry) {
    Store.update((d) => { d.log.push(Object.assign({ at: Date.now() }, entry)); if (d.log.length > LOG_MAX) d.log = d.log.slice(-LOG_MAX); });
  },
};

/* ───────────── 일정 계산 (APK Schedule) ───────────── */
function epochDayOf(date) { return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000); }
function dateOfEpochDay(ed) { const u = new Date(ed * 86400000); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }

class Schedule {
  constructor(gen, times, startEpochDay, days) { this.gen = gen; this.times = times; this.startEpochDay = startEpochDay; this.days = days; }
  get perDay() { return this.times.length; }
  get total() { return this.perDay * this.days; }
  get lastIndex() { return this.total - 1; }
  get startDate() { return dateOfEpochDay(this.startEpochDay); }
  get endDate() { return dateOfEpochDay(this.startEpochDay + this.days - 1); }
  isValidIndex(i) { return Number.isInteger(i) && i >= 0 && i < this.total; }
  doseDate(i) {
    const s = this.startDate, m = this.times[i % this.perDay];
    return new Date(s.getFullYear(), s.getMonth(), s.getDate() + Math.floor(i / this.perDay), Math.floor(m / 60), m % 60, 0, 0);
  }
  doseMillis(i) { return this.doseDate(i).getTime(); }
}

/* ───────────── 표시 형식 (APK Fmt.kt) ───────────── */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const Fmt = {
  ampm(h, m) { return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`; },
  dose(d) { return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) ${Fmt.ampm(d.getHours(), d.getMinutes())}`; },
  date(d) { return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; },
  shortDate(d) { return `${d.getMonth() + 1}월 ${d.getDate()}일`; },
  time(min) { return Fmt.ampm(Math.floor(min / 60), min % 60); },
  hhmm(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; },
  clock(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; },
  /** 한의원명 뒤 조사: 받침 없음/ㄹ받침 → "로", 그 외 → "으로" */
  withRo(name) {
    const n = name.trim(); const c = n.charCodeAt(n.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) { const j = (c - 0xAC00) % 28; return n + (j === 0 || j === 8 ? '로' : '으로'); }
    return n ? n + '(으)로' : n;
  },
};

/* ───────────── 환경 ───────────── */
const Env = {
  standalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true;
  },
  notifSupported() { return 'Notification' in window && 'serviceWorker' in navigator; },
  notifPermission() { return Env.notifSupported() ? Notification.permission : 'unsupported'; },
};

let swReg = null;
let installPrompt = null;

/* ───────────── 알림 (APK Notifier + Scheduler) ─────────────
 * 웹에는 '정해진 시각에 OS가 깨워주는 알람'이 없습니다.
 * 이 버전은 앱(페이지)이 살아 있는 동안 시각을 확인해 알림을 띄웁니다.
 * 같은 회차는 (1) markNotified 기록 (2) 알림 tag 로 이중 방지 → 중복 알림 없음.
 */
const Notify = {
  timer: null,

  async show(s, i) {
    if (Env.notifPermission() !== 'granted' || !swReg) return false;
    const tag = `dose-${s.gen}-${i}`;
    await swReg.showNotification('한약 드실게요', {
      body: '처방된 한약을 드실 시간입니다',
      tag,
      renotify: false,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: [300, 150, 300],
      timestamp: s.doseMillis(i),
      data: { kind: 'dose', gen: s.gen, index: i, due: s.doseMillis(i), url: `./?dose=${s.gen}.${i}&n=1` },
    });
    return true;
  },

  async close(gen, i) {
    if (!swReg || !swReg.getNotifications) return;
    try { (await swReg.getNotifications({ tag: `dose-${gen}-${i}` })).forEach((n) => n.close()); } catch (e) { /* noop */ }
  },
  async closeAll() {
    if (!swReg || !swReg.getNotifications) return;
    try { (await swReg.getNotifications()).forEach((n) => n.close()); } catch (e) { /* noop */ }
  },

  /** 예정 시각이 지난 회차를 확인해 알림. 여러 탭/창이 동시에 확인해도 한 번에 하나만 실행 (Web Locks) */
  tick() {
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request('hanyak-notify', () => Notify.tickLocked()).catch(() => {});
    }
    return Notify.tickLocked();
  },

  async tickLocked() {
    const s = Store.schedule();
    if (!s) return;
    const now = Date.now();
    let i = Store.lastNotified(s.gen) + 1;
    while (s.isValidIndex(i) && s.doseMillis(i) <= now) {
      const due = s.doseMillis(i);
      if (Store.markNotified(s.gen, i)) {
        const fresh = now - due <= NOTIFY_GRACE_MS;
        if (fresh && !Store.isCompleted(i)) {
          const shown = await Notify.show(s, i);
          Store.log({ type: shown ? '알림 표시' : '알림 실패(권한)', label: Fmt.dose(new Date(due)), due });
        } else if (!fresh) {
          Store.log({ type: '지난 회차(알림 생략)', label: Fmt.dose(new Date(due)), due });
        }
      }
      i++;
    }
    if (currentView === 'home') renderHome();
    Notify.arm();
  },

  /** 다음 회차 시각에 맞춰 타이머 (페이지가 살아 있을 때만 동작) */
  arm() {
    clearTimeout(Notify.timer);
    const s = Store.schedule();
    if (!s) return;
    const i = Store.lastNotified(s.gen) + 1;
    if (!s.isValidIndex(i)) return;
    const wait = Math.max(0, Math.min(s.doseMillis(i) - Date.now(), 60 * 60 * 1000));
    Notify.timer = setTimeout(Notify.tick, wait + 200);
  },

  async test() {
    if (Env.notifPermission() !== 'granted') { await askPermission(); }
    if (Env.notifPermission() !== 'granted') return;
    const due = Date.now() + 10000;
    toast('10초 뒤 테스트 알림을 보냅니다');
    setTimeout(async () => {
      if (!swReg) return;
      await swReg.showNotification('한약 드실게요', {
        body: '테스트 알림입니다',
        tag: `test-${due}`,
        icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
        vibrate: [300, 150, 300], timestamp: due,
        data: { kind: 'test', due, url: './?diag=1' },
      });
      Store.log({ type: '테스트 알림 표시', label: '테스트', due });
      if (currentView === 'diag') renderDiag();
    }, due - Date.now());
  },
};

async function askPermission() {
  if (!Env.notifSupported()) { toast('이 브라우저는 알림을 지원하지 않아요'); return 'unsupported'; }
  if (Notification.permission === 'denied') {
    await confirmBox('알림이 차단되어 있어요.\n\n브라우저 주소창 옆 ⓘ(또는 자물쇠) → 권한 → 알림 → 허용으로 바꿔 주세요.\n설치한 앱이라면: 휴대폰 설정 → 애플리케이션 → 한약 드실게요 → 알림', '확인', null);
    return 'denied';
  }
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}

/* ───────────── 화면 전환 ───────────── */
let currentView = null;
const VIEWS = ['home', 'guide', 'setup', 'dose', 'final', 'diag'];

function show(view) {
  VIEWS.forEach((v) => { $('v-' + v).hidden = v !== view; });
  if (currentView !== 'dose' && view === 'dose') { /* noop */ }
  if (currentView === 'dose' && view !== 'dose') Dose.stopVideo();
  currentView = view;
  window.scrollTo(0, 0);
}
function go(view, opts) {
  opts = opts || {};
  if (view !== 'home' && !opts.replace) history.pushState({ v: view }, '');
  ({ home: renderHome, guide: renderGuide, setup: () => renderSetup(opts), final: () => renderFinal(opts), diag: renderDiag })[view]();
}
window.addEventListener('popstate', () => { renderHome(); });

/* ───────────── 첫 화면 (MainActivity) ───────────── */
let homeDue = -1, homeGen = -1;

function renderHome() {
  show('home');
  const s = Store.schedule();
  const standalone = Env.standalone();
  ['homePeriod', 'homeCheck', 'homeSetup', 'homeGuide', 'homeWarn', 'homeTrial', 'homeSettings'].forEach((id) => { $(id).hidden = true; });

  if (!Store.hasClinic() || !s) {
    $('homeMain').textContent = '처음 설정이 필요해요';
    $('homeSub').textContent = standalone ? '한의원에서 복용 일정을 설정해 드립니다' : '먼저 홈 화면에 설치해 주세요';
    if (standalone) $('homeSetup').hidden = false;
    else { $('homeGuide').hidden = false; $('homeSettings').hidden = false; }
    return;
  }

  const done = Store.completed();
  if (done.has(s.lastIndex)) { renderFinal({ fromHome: true }); return; }

  const now = Date.now();
  let due = -1, next = -1;
  for (let i = 0; i < s.total; i++) { if (s.doseMillis(i) <= now) due = i; else { next = i; break; } }

  homeGen = s.gen;
  if (due >= 0 && !done.has(due)) {
    homeDue = due;
    $('homeMain').textContent = '지금 드실 한약이 있어요';
    $('homeSub').textContent = Fmt.dose(s.doseDate(due));
    $('homeCheck').hidden = false;
  } else {
    homeDue = -1;
    if (next >= 0) { $('homeMain').textContent = '다음 복용'; $('homeSub').textContent = Fmt.dose(s.doseDate(next)); }
    else { $('homeMain').textContent = '복용 일정이 끝났어요'; $('homeSub').textContent = ''; }
  }
  $('homePeriod').hidden = false;
  $('homePeriod').textContent = `복용 기간 ${Fmt.shortDate(s.startDate)} ~ ${Fmt.shortDate(s.endDate)}`;
  $('homeSettings').hidden = false;
  $('homeTrial').hidden = false;

  const perm = Env.notifPermission();
  if (perm !== 'granted') {
    $('homeWarn').hidden = false;
    $('homeWarnText').textContent = perm === 'unsupported' ? '이 브라우저에서는 알림을 받을 수 없어요' : '알림이 꺼져 있어 복용 시간을 알려드릴 수 없어요';
    $('homeWarnBtn').textContent = '알림 켜기';
    $('homeWarnBtn').hidden = perm === 'unsupported';
    $('homeWarnBtn').onclick = async () => { await askPermission(); renderHome(); };
  } else if (!standalone) {
    $('homeWarn').hidden = false;
    $('homeWarnText').textContent = '홈 화면에 설치해야 알림을 더 안정적으로 받을 수 있어요';
    $('homeWarnBtn').hidden = false;
    $('homeWarnBtn').textContent = '설치 방법 보기';
    $('homeWarnBtn').onclick = () => go('guide');
  }
}
$('homeCheck').onclick = () => { if (homeDue >= 0) Dose.open(homeGen, homeDue, false); };
$('homeSetup').onclick = () => go('setup');
$('homeGuide').onclick = () => go('guide');
$('homeSettings').onclick = () => go('setup');

/* ───────────── 시작하기 (설치 안내) ───────────── */
function renderGuide() {
  show('guide');
  const st = Env.standalone();
  $('guideInstalled').hidden = !st;
  $('guideManual').hidden = st;
  $('guideInstall').hidden = st || !installPrompt;
}
$('guideInstall').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch (e) { /* noop */ }
  installPrompt = null;
  renderGuide();
};
$('guideNext').onclick = () => go('setup', { replace: true });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (currentView === 'guide') renderGuide(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('설치되었어요. 홈 화면의 아이콘으로 열어 주세요'); });

/* ───────────── 설정 (SetupActivity) ───────────── */
const DEFAULTS = { 1: [8 * 60], 2: [8 * 60, 19 * 60], 3: [8 * 60, 13 * 60, 19 * 60] };
const form = { count: 2, times: [8 * 60, 19 * 60, 0], start: epochDayOf(new Date()) };

function renderSetup(opts) {
  show('setup');
  const d = Store.load();
  $('setName').value = d.clinicName;
  $('setPhone').value = d.clinicPhone;

  const s = Store.schedule();
  if (s) {
    form.count = s.perDay;
    form.times = s.times.concat([0, 0, 0]).slice(0, 3);
    form.start = s.startEpochDay;
    $('setDays').value = String(s.days);
    $('setReset').hidden = false;
    $('setCurrent').hidden = false;
    $('setCurrent').textContent = `현재 일정: 하루 ${s.perDay}회 · ${Fmt.shortDate(s.startDate)} ~ ${Fmt.shortDate(s.endDate)} (총 ${s.total}회)`;
  } else {
    form.count = 2;
    form.times = DEFAULTS[2].concat([0]);
    form.start = epochDayOf(new Date());
    $('setDays').value = '';
    $('setReset').hidden = true;
    $('setCurrent').hidden = true;
  }
  updateScheduleViews();
  updateChecks();
  if (opts && opts.focusSchedule) requestAnimationFrame(() => $('scheduleSection').scrollIntoView({ block: 'start' }));
}

function daysInput() { const v = parseInt($('setDays').value, 10); return Number.isFinite(v) ? v : null; }
function writeTimesToForm() {
  document.querySelectorAll('.time-row').forEach((row) => {
    const i = +row.dataset.i, v = row.querySelector('input').value;
    if (/^\d{2}:\d{2}$/.test(v)) form.times[i] = +v.slice(0, 2) * 60 + +v.slice(3, 5);
  });
}
function updateScheduleViews() {
  document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.count === form.count)));
  document.querySelectorAll('.time-row').forEach((row) => {
    const i = +row.dataset.i;
    row.hidden = i >= form.count;
    row.querySelector('input').value = Fmt.hhmm(form.times[i]);
  });
  const sd = dateOfEpochDay(form.start);
  $('setStart').value = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
  const days = daysInput();
  $('setSummary').textContent = days && days >= 1 && days <= 365
    ? `하루 ${form.count}회 × ${days}일 = 총 ${form.count * days}회\n${Fmt.shortDate(sd)} ~ ${Fmt.shortDate(dateOfEpochDay(form.start + days - 1))}`
    : '복용 기간을 입력하면 총 복용 횟수가 계산됩니다';
}
function updateChecks() {
  const st = Env.standalone();
  $('chkInstall').textContent = st ? '홈 화면 설치 ✓' : '홈 화면 설치 — 권장';
  $('chkInstallBtn').hidden = st;
  const p = Env.notifPermission();
  $('chkNotif').textContent = p === 'granted' ? '알림 허용 ✓' : p === 'unsupported' ? '알림 — 이 브라우저는 지원하지 않음' : p === 'denied' ? '알림 허용 — 차단됨' : '알림 허용 — 꺼져 있음';
  $('chkNotifBtn').hidden = p === 'granted' || p === 'unsupported';
}

document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
  form.count = +b.dataset.count;
  form.times = DEFAULTS[form.count].concat([0, 0, 0]).slice(0, 3);
  updateScheduleViews();
}));
document.querySelectorAll('.time-row input').forEach((inp) => inp.addEventListener('change', () => { writeTimesToForm(); updateScheduleViews(); }));
$('setStart').addEventListener('change', () => {
  const v = $('setStart').value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) form.start = epochDayOf(new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)));
  updateScheduleViews();
});
$('setDays').addEventListener('input', updateScheduleViews);
$('chkInstallBtn').onclick = () => go('guide');
$('chkNotifBtn').onclick = async () => { await askPermission(); updateChecks(); };
$('testNotif').onclick = () => Notify.test();
$('openDiag').onclick = () => go('diag');

$('saveClinic').onclick = () => {
  const name = $('setName').value.trim(), phone = $('setPhone').value.trim();
  if (!name) { toast('한의원명을 입력해 주세요'); return; }
  if ((phone.match(/\d/g) || []).length < 7) { toast('전화번호를 확인해 주세요'); return; }
  Store.saveClinic(name, phone);
  toast('한의원 정보를 저장했어요');
};

$('saveSchedule').onclick = async () => {
  if (!Store.hasClinic()) { toast('한의원 정보를 먼저 저장해 주세요'); return; }
  writeTimesToForm();
  const days = daysInput();
  if (!days || days < 1 || days > 365) { toast('복용 기간을 1~365일 사이로 입력해 주세요'); return; }
  const list = form.times.slice(0, form.count).sort((a, b) => a - b);
  if (new Set(list).size !== list.length) { toast('같은 복용 시간이 있어요. 시간을 확인해 주세요'); return; }
  const preview = new Schedule(0, list, form.start, days);
  if (preview.doseMillis(preview.lastIndex) <= Date.now()) { toast('모든 복용 시간이 이미 지났어요. 시작일과 시간을 확인해 주세요'); return; }

  if (Store.schedule()) {
    const ok = await confirmBox('새 일정으로 바꾸면 기존 일정과 복용 기록이 지워집니다.\n(한의원 정보는 유지됩니다)', '새 일정 저장', '취소');
    if (!ok) return;
  }
  // 권한 요청은 사용자 터치 직후에 해야 하므로 저장 전에 요청
  if (Env.notifPermission() === 'default') await askPermission();

  await Notify.closeAll();
  const sch = Store.saveSchedule(list, form.start, days);
  // 이미 지난 오늘 회차는 알림 대상에서 제외 (저장 직후 지난 회차 알림이 한꺼번에 뜨지 않도록)
  const s = Store.schedule();
  for (let i = 0; i < s.total && s.doseMillis(i) <= Date.now(); i++) Store.markNotified(sch.gen, i);
  requestPersist();
  Notify.arm();

  if (Env.notifPermission() === 'granted') {
    toast('복용 알림을 설정했어요');
    history.replaceState(null, '', './');
    renderHome();
  } else {
    toast('일정을 저장했어요. 아래 알림 점검을 확인해 주세요');
    updateChecks();
    $('checkSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

/** 새 복용 시작 (설정: 확인창 후 / 최종 화면: 바로) — APK SetupActivity.startNewCourse */
async function startNewCourse() {
  await Notify.closeAll();      // 떠 있는 복용 알림 제거
  clearTimeout(Notify.timer);    // 예약 타이머 취소
  Store.clearSchedule();         // 일정·완료 기록 초기화 (한의원 정보 유지)
  toast('새 복용 일정을 설정해 주세요');
  history.replaceState(null, '', './');
  history.pushState({ v: 'setup' }, '');
  renderSetup({ focusSchedule: true });
}
$('setReset').onclick = async () => {
  const ok = await confirmBox('현재 복용 기록을 종료하고 새 복용을 시작할까요?', '새로 시작', '취소');
  if (ok) startNewCourse();
};

/* ───────────── 복용 회차 (DoseActivity) ───────────── */
const Dose = {
  gen: -1, index: -1, phase: null, prepareTimer: null, played: false,

  /** fromNotification === true 일 때만 영상 재생 */
  open(gen, index, fromNotification) {
    const s = Store.schedule();
    if (!s || s.gen !== gen || !s.isValidIndex(index)) { renderHome(); return; }   // 이전 일정의 알림 등
    Dose.gen = gen; Dose.index = index; Dose.played = false;
    Notify.close(gen, index);
    history.pushState({ v: 'dose' }, '');
    show('dose');
    $('doseWhen').textContent = Fmt.dose(s.doseDate(index));
    $('doseDrank').disabled = false;
    if (Store.isCompleted(index)) {
      if (index === s.lastIndex) { renderFinal({}); return; }
      Dose.setPhase('done');
    } else {
      Dose.setPhase(fromNotification ? 'video' : 'confirm');
    }
  },

  setPhase(p) {
    Dose.phase = p;
    $('doseVideoBox').hidden = p !== 'video';
    $('doseConfirm').hidden = p !== 'confirm';
    $('doseDone').hidden = p !== 'done';
    if (p === 'video') Dose.playVideo();
  },

  async playVideo() {
    const v = $('doseVideo');
    $('doseTapPlay').hidden = true;
    v.loop = false;            // 반복 재생 없음
    v.muted = false;           // 원본 음성 포함
    v.onended = () => Dose.finishVideo();
    v.onerror = () => Dose.finishVideo();
    v.onplaying = () => { Dose.played = true; clearTimeout(Dose.prepareTimer); };
    if (!v.src) v.src = 'media/hanyak_intro.mp4';   // 서비스 워커 캐시 → 오프라인 재생
    v.currentTime = 0;
    clearTimeout(Dose.prepareTimer);
    Dose.prepareTimer = setTimeout(() => { if (!Dose.played && $('doseTapPlay').hidden) Dose.finishVideo(); }, PREPARE_TIMEOUT_MS);
    try {
      await v.play();
    } catch (e) {
      // 소리 있는 자동재생이 막힌 경우(설치하지 않은 브라우저 등): 큰 버튼으로 한 번 눌러 재생
      clearTimeout(Dose.prepareTimer);
      $('doseTapPlay').hidden = false;
    }
  },

  finishVideo() {
    clearTimeout(Dose.prepareTimer);
    if (Dose.phase !== 'video') return;
    Dose.stopVideo();
    Dose.setPhase('confirm');
  },

  stopVideo() {
    const v = $('doseVideo');
    clearTimeout(Dose.prepareTimer);
    try { v.pause(); } catch (e) { /* noop */ }
  },

  drank() {
    $('doseDrank').disabled = true;
    Store.markCompleted(Dose.gen, Dose.index);   // 이미 완료된 회차면 중복 처리하지 않음
    Notify.close(Dose.gen, Dose.index);
    const s = Store.schedule();
    if (s && Dose.index === s.lastIndex) { renderFinal({}); return; }
    Dose.setPhase('done');
  },
};
$('doseTapPlay').onclick = async () => {
  $('doseTapPlay').hidden = true;
  try { await $('doseVideo').play(); } catch (e) { Dose.finishVideo(); }
};
$('doseDrank').onclick = () => Dose.drank();
$('doseClose').onclick = () => { history.replaceState(null, '', './'); renderHome(); };
document.addEventListener('visibilitychange', () => {
  if (currentView === 'dose' && Dose.phase === 'video') {
    const v = $('doseVideo');
    if (document.hidden) v.pause(); else v.play().catch(() => { $('doseTapPlay').hidden = false; });
  }
});

/* ───────────── 최종 완료 (FinalActivity) ───────────── */
function renderFinal(opts) {
  show('final');
  const d = Store.load();
  $('finalContact').textContent = `문의사항이나 예약은\n${Fmt.withRo(d.clinicName)} 연락해 주세요.`;
  const phone = d.clinicPhone.trim();
  if (phone) {
    $('finalCall').hidden = false;
    $('finalCall').textContent = `☎  ${phone}`;
    // tel: 링크 → 전화 앱에 번호만 입력된 상태로 열림 (자동 발신 없음)
    $('finalCall').href = 'tel:' + phone.replace(/[^\d+]/g, '');
  } else {
    $('finalCall').hidden = true;
  }
  $('finalNew').disabled = false;
  $('finalSettings').hidden = !(opts && opts.fromHome);
}
// 복용을 모두 마친 화면이므로 확인창 없이 바로 새 일정 입력
$('finalNew').onclick = () => { $('finalNew').disabled = true; startNewCourse(); };
$('finalSettings').onclick = () => go('setup');

/* ───────────── 알림 진단 ───────────── */
async function renderDiag() {
  show('diag');
  const rows = [
    ['앱 버전', APP_VERSION],
    ['실행 방식', Env.standalone() ? '홈 화면 앱 (설치됨)' : '브라우저 탭'],
    ['알림 권한', Env.notifPermission()],
    ['서비스 워커', navigator.serviceWorker && navigator.serviceWorker.controller ? '동작 중' : '없음'],
    ['오프라인 캐시', swReg ? '사용' : '-'],
    ['저장소 영구 보존', navigator.storage && navigator.storage.persisted ? String(await navigator.storage.persisted()) : '확인 불가'],
    ['Web Push 지원', 'PushManager' in window ? '예 (서버 미사용)' : '아니오'],
    ['예약 알림 API', 'TimestampTrigger' in window ? '있음' : '없음 (정식 출시 안 됨)'],
    ['브라우저', navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120)],
  ];
  $('diagEnv').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('');
  const log = Store.load().log.slice().reverse();
  $('diagLog').innerHTML = '<tr><th>기록</th><th>예정</th><th>실제</th><th>지연</th></tr>' + (log.length ? log.map((e) => {
    const delay = e.due ? Math.round((e.at - e.due) / 1000) : null;
    return `<tr><td>${e.type}</td><td>${e.due ? Fmt.clock(e.due) : '-'}</td><td>${Fmt.clock(e.at)}</td><td>${delay === null ? '-' : delay + '초'}</td></tr>`;
  }).join('') : '<tr><td colspan="4">기록 없음</td></tr>');
}
$('diagTest').onclick = () => Notify.test();
$('diagClear').onclick = () => { Store.update((d) => { d.log = []; }); renderDiag(); };
$('diagBack').onclick = () => { history.back(); };

/* ───────────── 공통 UI ───────────── */
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function confirmBox(text, yes, no) {
  return new Promise((resolve) => {
    $('modalText').textContent = text;
    $('modalYes').textContent = yes;
    $('modalNo').hidden = !no;
    if (no) $('modalNo').textContent = no;
    $('modal').hidden = false;
    $('modalYes').onclick = () => { $('modal').hidden = true; resolve(true); };
    $('modalNo').onclick = () => { $('modal').hidden = true; resolve(false); };
  });
}
async function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* noop */ }
}

/* ───────────── 서비스 워커 메시지 (알림 터치) ───────────── */
function handleOpenMessage(m) {
  if (!m || m.type !== 'open') return;
  if (m.kind === 'dose') {
    Store.log({ type: '알림 터치', label: '', due: m.due, at: m.clickedAt || Date.now() });
    Dose.open(m.gen, m.index, true);
  } else if (m.kind === 'test') {
    Store.log({ type: '테스트 알림 터치', label: '', due: m.due, at: m.clickedAt || Date.now() });
    go('diag');
  }
}

/* ───────────── 시작 ───────────── */
async function boot() {
  const q = new URLSearchParams(location.search);

  // QR 로 전달된 한의원 정보 (?c=한의원명&t=전화번호) — 한의원마다 다른 QR 사용 가능, 코드에 하드코딩 없음
  if (q.get('c') && q.get('t')) Store.saveClinic(q.get('c').slice(0, 40), q.get('t').slice(0, 20));

  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      swReg = await navigator.serviceWorker.getRegistration() || swReg;
    } catch (e) { swReg = null; }
    navigator.serviceWorker.addEventListener('message', (ev) => handleOpenMessage(ev.data));
  }

  // 알림 터치로 열린 경우에만 영상 재생. 주소의 표시는 즉시 지워서 새로고침·재실행 때 다시 재생되지 않게 함
  const dose = q.get('dose');
  const fromNotif = q.get('n') === '1';
  const clickedAt = +q.get('ct') || Date.now();
  const diag = q.get('diag');
  history.replaceState(null, '', './');

  if (dose && /^\d+\.\d+$/.test(dose)) {
    const [g, i] = dose.split('.').map(Number);
    if (fromNotif) {
      const s = Store.schedule();
      Store.log({ type: '알림 터치', label: '', due: s && s.gen === g && s.isValidIndex(i) ? s.doseMillis(i) : null, at: clickedAt });
    }
    Dose.open(g, i, fromNotif);
  } else if (diag) {
    Store.log({ type: '테스트 알림 터치', label: '', due: null, at: clickedAt });
    renderHome(); go('diag');
  } else {
    renderHome();
  }

  Notify.tick();
  setInterval(Notify.tick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Notify.tick(); });
  window.addEventListener('pageshow', () => Notify.tick());
  window.addEventListener('focus', () => Notify.tick());
}
boot();
