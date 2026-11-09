"""Any server that speaks the OpenAI chat completions API: Gemini, Groq, OpenRouter, Ollama...
Standard library only (urllib): one POST with a streamed (SSE) reply needs no HTTP package."""
import json
import logging
import urllib.error
import urllib.request

from app.core.llm.base import LLMBackend, LLMError, Usage

log = logging.getLogger(__name__)
TIMEOUT = 60  # seconds without a byte from the server


class OpenAICompatBackend(LLMBackend):
    name = "OpenAI 호환"

    def __init__(self, base_url, api_key, model, max_tokens):
        self.base_url, self.api_key, self.model, self.max_tokens = base_url.strip().rstrip("/"), api_key, model, max_tokens

    def is_available(self):
        return bool(self.base_url and self.model)  # a key is optional: a local Ollama takes none

    def stream(self, system, messages):
        body = {"model": self.model, "stream": True, "max_tokens": self.max_tokens,
                "messages": [{"role": "system", "content": system}, *messages]}
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = urllib.request.Request(f"{self.base_url}/chat/completions", json.dumps(body).encode(), headers)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                for raw in response:  # one SSE line at a time
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    event = json.loads(data)
                    if "error" in event:
                        raise LLMError(f"서버 오류: {_message(event)}", "other")
                    for choice in event.get("choices") or []:
                        if choice.get("finish_reason") == "content_filter":
                            raise LLMError("이 질문에는 답할 수 없다는 응답을 받았습니다.", "refused")
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield text
                    if event.get("usage"):  # sent by servers that report it, in the last event
                        usage = event["usage"]
                        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
                        yield Usage(usage.get("prompt_tokens", 0), cached, usage.get("completion_tokens", 0))
        except urllib.error.HTTPError as error:
            raise _http_error(error) from error
        except TimeoutError as error:  # connected, then silence: Gemini does this when a model is overloaded
            raise LLMError(f"서버가 {TIMEOUT}초 동안 답하지 않았습니다. 모델이 붐비는 중일 수 있으니 다른 모델을 써 보세요.",
                           "network") from error
        except (urllib.error.URLError, ConnectionError) as error:
            raise LLMError(f"서버에 연결하지 못했습니다 ({self.base_url}). 주소와 인터넷 연결을 확인하세요.",
                           "network") from error
        except json.JSONDecodeError as error:
            raise LLMError("서버 응답을 읽지 못했습니다. 주소가 OpenAI 호환 API 인지 확인하세요.", "other") from error


def _message(payload):
    """The error text in the shapes providers use: {"error": {"message"}}, {"error": "..."}, [{"error": ...}]."""
    if isinstance(payload, list) and payload:
        payload = payload[0]
    error = payload.get("error", payload) if isinstance(payload, dict) else payload
    return str(error.get("message", error) if isinstance(error, dict) else error)


def _http_error(error):
    try:
        message = _message(json.loads(error.read().decode("utf-8", "replace")))
    except (ValueError, OSError):
        message = error.reason
    log.warning("openai-compatible error %s: %s", error.code, message)
    if error.code in (401, 403) or "api key" in message.lower():  # Gemini answers a bad key with 400
        return LLMError(f"API 키가 맞지 않거나 권한이 없습니다. ({error.code})", "auth")
    if error.code == 429:
        return LLMError("요청 한도를 넘었습니다. 잠시 뒤 다시 물어보세요.", "rate_limit")
    if error.code == 400 and any(word in message.lower() for word in ("context", "too long", "too many tokens")):
        return LLMError("보낸 내용이 너무 깁니다.", "context_too_long")
    if error.code in (502, 503, 504):
        return LLMError(f"제공자 서버가 지금 바쁩니다 ({error.code}). 잠시 뒤 다시 하거나 다른 모델을 써 보세요.", "other")
    if error.code == 404:
        return LLMError(f"주소나 모델 이름을 찾지 못했습니다: {message}", "other")
    return LLMError(f"요청이 거부되었습니다 ({error.code}): {message}", "other")
