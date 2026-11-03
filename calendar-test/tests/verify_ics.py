"""달력 파일 독립 검증 — ics.js 와 다른 구현(python-dateutil 의 RRULE 해석)으로 알림 시각을 다시 계산해 비교.
실행: python3 calendar-test/tests/verify_ics.py <ics.test.js 가 만든 폴더>
"""
import json, sys, pathlib
from datetime import datetime, timezone, timedelta
from dateutil.rrule import rrulestr

KST = timezone(timedelta(hours=9))
folder = pathlib.Path(sys.argv[1])
ok = bad = 0
for f in sorted(folder.glob('*.ics')):
    raw = f.read_bytes().decode('utf-8')
    text = raw.replace('\r\n ', '')                       # 줄 접기 해제
    lines = text.split('\r\n')
    events, cur = [], None
    for l in lines:
        if l == 'BEGIN:VEVENT': cur = {}
        elif l == 'END:VEVENT': events.append(cur); cur = None
        elif cur is not None and ':' in l:
            k, v = l.split(':', 1); cur[k] = v
    got = []
    for e in events:
        start = datetime.strptime(e['DTSTART;TZID=Asia/Seoul'], '%Y%m%dT%H%M%S').replace(tzinfo=KST)
        for dt in rrulestr(e['RRULE'], dtstart=start):
            got.append(dt.astimezone(KST).strftime('%Y-%m-%d %H:%M'))
    got.sort()
    expected = sorted(json.loads(f.with_suffix('.json').read_text()))
    # 끝난 뒤 알림 없음: 마지막 알림 다음 날짜 이후 발생 0건
    good = got == expected and len(got) == len(set(got))
    print(('PASS' if good else 'FAIL'), f.stem, f'{len(got)}건', f'{got[0]} ~ {got[-1]}' if got else '')
    if good: ok += 1
    else:
        bad += 1
        print('  기대와 다름:', sorted(set(expected) ^ set(got))[:6])
print(f'\n{ok} passed, {bad} failed')
sys.exit(1 if bad else 0)
