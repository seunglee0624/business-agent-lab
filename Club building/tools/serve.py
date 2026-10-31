# 개발 서버: 캐시를 끄고(기본 http.server는 Cache-Control을 안 보내서 크롬이 고치기 전 JS 모듈을 계속 쓸 수 있음),
# 언론 탭 기사·댓글을 쓰는 AI 요청을 OpenRouter로 대신 보낸다. API 키는 환경 변수로만 받고 브라우저에는 넘기지 않는다.
# 실행: OPENROUTER_API_KEY=... OPENROUTER_MODEL=... python3 tools/serve.py [포트]   (둘 중 하나라도 없으면 게임은 틀 기사를 쓴다)
import json
import os
import re
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

API_URL = os.environ.get('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1').rstrip('/') + '/chat/completions'
MAX_BODY = 200_000  # 화면이 보내는 요청 크기 상한 (바이트)
FENCE = re.compile(r'^\s*```(?:json)?\s*(.*?)\s*```\s*$', re.S)


# ▼ API 키 넣는 곳: 이 파일에 키를 직접 적지 말 것 (git에 올라감). 서버를 켤 때 환경 변수로 넘긴다.
#   OPENROUTER_API_KEY=sk-or-... OPENROUTER_MODEL=제공자/모델:free python3 tools/serve.py 8010
#   매번 치기 싫으면 ~/.bashrc 맨 아래에 export OPENROUTER_API_KEY=sk-or-... 한 줄 (모델도 같은 식)
#   키는 https://openrouter.ai 의 Keys 메뉴에서 만든다
def api_key():
    return os.environ.get('OPENROUTER_API_KEY', '').strip()


def model():
    # 무료 모델 목록이 자주 바뀌어서 코드에 박지 않는다
    return os.environ.get('OPENROUTER_MODEL', '').strip()


def ready():
    return bool(api_key() and model())


def parse_json(text):
    """모델이 JSON 형식 지정을 무시하고 ```json 블록으로 감싸 보내도 읽는다."""
    m = FENCE.match(text)
    return json.loads(m.group(1) if m else text)


def write_article(req):
    """core가 만든 { system, user, schema }로 기사·댓글 JSON을 받아 온다."""
    payload = {
        'model': model(),
        'max_tokens': 4000,
        'messages': [
            {'role': 'system', 'content': req['system']},
            {'role': 'user', 'content': req['user']},
        ],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'press_article', 'strict': True, 'schema': req['schema']}},
    }
    http_req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'content-type': 'application/json',
            'authorization': f'Bearer {api_key()}',
            'x-title': 'Club Building',
        },
        method='POST',
    )
    with urllib.request.urlopen(http_req, timeout=60) as res:
        msg = json.load(res)
    if 'error' in msg:
        raise RuntimeError(str(msg['error'].get('message', msg['error']))[:200])
    choice = (msg.get('choices') or [{}])[0]
    if choice.get('finish_reason') not in ('stop', None):
        raise RuntimeError(f"finish_reason {choice.get('finish_reason')}")
    text = (choice.get('message') or {}).get('content')
    if not text:
        raise RuntimeError('응답에 글이 없습니다')
    return parse_json(text)


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
            return self.send_json(200, {'key': ready()})
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/press':
            return self.send_json(404, {'ok': False, 'code': 'error', 'error': '없는 주소'})
        if not ready():
            return self.send_json(503, {'ok': False, 'code': 'nokey', 'error': 'OPENROUTER_API_KEY나 OPENROUTER_MODEL이 없습니다'})
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
if api_key() and not model():
    print('OPENROUTER_MODEL이 없어서 AI 기사를 쓰지 않습니다 (틀 기사)', file=sys.stderr)
root = Path(__file__).resolve().parent.parent
ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(root))).serve_forever()
