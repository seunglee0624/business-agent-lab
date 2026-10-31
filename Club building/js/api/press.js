// 로컬 개발 서버(tools/serve.py)를 거쳐 AI에 기사·댓글을 요청한다. API 키는 서버만 안다

// 'ok' | 'nokey' | 'noserver' (AI 주소가 없는 서버로 띄움)
export async function pressStatus() {
  try {
    const res = await fetch('/api/press/status');
    if (!res.ok) return 'noserver';
    const body = await res.json();
    return body.key ? 'ok' : 'nokey';
  } catch {
    return 'noserver';
  }
}

// request: core가 만든 { system, user, schema }. 돌려주는 값: AI가 쓴 { headline, body, comments }
export async function requestArticle(request) {
  const res = await fetch('/api/press', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    const err = new Error(body?.error ?? `HTTP ${res.status}`);
    err.code = body?.code ?? 'error';
    throw err;
  }
  return body.data;
}
