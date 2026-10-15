"""한약 드실게요 QR 코드 만들기 (OpenCV 사용, 인터넷 불필요)
사용법:
  python3 tools/make_qr.py <앱 주소> [한의원명] [전화번호] [출력.png]
예:
  python3 tools/make_qr.py https://owner.github.io/hanyak-drink-pwa/ 행복한의원 063-123-4567 qr-행복한의원.png
한의원명·전화번호를 넣으면 환자가 QR로 접속할 때 한의원 정보가 자동 입력됩니다.
"""
import sys, urllib.parse
import cv2, numpy as np

url = sys.argv[1]
if len(sys.argv) >= 4:
    url += ('&' if '?' in url else '?') + urllib.parse.urlencode({'c': sys.argv[2], 't': sys.argv[3]})
out = sys.argv[4] if len(sys.argv) >= 5 else 'qr.png'

enc = cv2.QRCodeEncoder.create()
qr = enc.encode(url)                      # 모듈 1px, 흰 테두리 포함
scale = max(8, 900 // qr.shape[0])
img = cv2.resize(qr, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
ok = cv2.imwrite(out, img)

data, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
print('saved:', out, img.shape, '| decode check:', 'OK' if data == url else 'MISMATCH', '|', data)
sys.exit(0 if ok and data == url else 1)
