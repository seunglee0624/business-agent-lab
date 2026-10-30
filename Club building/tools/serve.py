# 개발 서버: 캐시를 끈다 (기본 http.server는 Cache-Control을 안 보내서 크롬이 고치기 전 JS 모듈을 계속 쓸 수 있음)
# 실행: python3 tools/serve.py [포트]
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
root = Path(__file__).resolve().parent.parent
ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=str(root))).serve_forever()
