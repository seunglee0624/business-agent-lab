# 개발 서버: 캐시를 끄고(기본 http.server는 Cache-Control을 안 보내서 크롬이 고치기 전 JS 모듈을 계속 쓸 수 있음),
# 언론 탭 기사·댓글을 쓰는 AI 요청을 대신 보낸다. API 키는 환경 변수로만 받고 브라우저에는 넘기지 않는다.
# 실행: ANTHROPIC_API_KEY=... python3 tools/serve.py [포트]   (키 없이 켜면 게임은 틀 기사를 쓴다)
import json
import os
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

API_URL = os.environ.get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com').rstrip('/') + '/v1/messages'
MODEL = 'claude-haiku-5-5'
MAX_BODY = 200_000  # 화면이 보내는 요청 크기 상한 (바이트)


def api_key():
    return os.environ.get('ANTHROPIC_API_KEY', '').strip()


def write_article(req):
    """core가 만든 { system, user, schema }로 기사·댓글 JSON을 받아 온다."""
    payload = {
        'model': MODEL,
        'max_tokens': 4000,
        'system': req['system'],
        'messages': [{'role': 'user', 'content': req['user']}],
        'output_config': {'effort': 'low', 'format': {'type': 'json_schema', 'schema': req['schema']}},
    }
    http_req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'content-type': 'application/json',
            'x-api-key': api_key(),
            'anthropic-version': '2026-10-21',
        },
        method='POST',
    )
    with urllib.request.urlopen(http_req, timeout=60) as res:
        msg = json.load(res)
    if msg.get('stop_reason') != 'end_turn':
        raise RuntimeError(f"stop_reason {msg.get('stop_reason')}")
    text = next((b['text'] for b in msg.get('content', []) if b.get('type') == 'text'), None)
    if text is None:
        raise RuntimeError('응답에 글이 없습니다')
    return json.loads(text)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/press/status':
            return self.send_json(200, {'key': bool(api_key()), 'model': MODEL})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/press':
            return self.send_json(404, {'ok': False, 'code': 'error', 'error': '없는 주소'})
        if not api_key():
            return self.send_json(503, {'ok': False, 'code': 'nokey', 'error': 'ANTHROPIC_API_KEY가 없습니다'})
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BODY:
            return self.send_json(413, {'ok': False, 'code': 'error', 'error': '요청 크기'})
        try:
            req = json.loads(self.rfile.read(length))
            if not all(isinstance(req.get(k), t) for k, t in (('system', str), ('user', str), ('schema', dict))):
                return self.send_json(400, {'ok': False, 'code': 'error', 'error': '요청 형식'})
            return self.send_json(200, {'ok': True, 'data': write_article(req)})
        except urllib.error.HTTPError as err:
            detail = err.read().decode('utf-8', 'replace')[:300]
            self.log_message('AI 요청 실패 %s: %s', err.code, detail)
            return self.send_json(502, {'ok': False, 'code': 'nokey' if err.code == 401 else 'error', 'error': f'API {err.code}'})
        except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError) as err:
            self.log_message('AI 요청 실패: %s', err)
            return self.send_json(502, {'ok': False, 'code': 'error', 'error': str(err)[:200]})


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
root = Path(__file__).resolve().parent.parent
ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(root))).serve_forever()
