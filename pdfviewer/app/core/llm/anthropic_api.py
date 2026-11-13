import logging

from app.core.llm.base import LLMBackend, LLMError, Usage

log = logging.getLogger(__name__)

# Models that accept the server-side refusal fallback ("default" picks the substitute per refusal category).
# Haiku has none, so other models are sent without it.
FALLBACK_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-fable-5-2")
# the chat's quick model menu, cheapest first (input/output $ per million tokens)
MODELS = {"claude-haiku-5-5": "Haiku 5.5 · $0.1/$0.5", "claude-sonnet-5-5": "Sonnet 5.5 · $2/$10",
          "claude-opus-5-5": "Opus 5.5 · $4/$20", "claude-fable-5-2": "Fable 5.2 · $8/$40"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicBackend(LLMBackend):
    name = "Anthropic"

    def __init__(self, model, effort, max_tokens, api_key=""):
        self.model, self.effort, self.max_tokens = model, effort, max_tokens
        self._api_key = api_key  # only from the AI settings, never the environment (user decision)
        self._client = None

    def is_available(self):
        return bool(self._api_key)

    def stream(self, system, messages):
        if not self.is_available():
            raise LLMError("API 키가 없습니다.", "auth")
        import anthropic  # here, not at the top: it takes about a second, which the app's start should not wait for
        if self._client is None:
            self._client = anthropic.Anthropic(api_key=self._api_key)
        extra = {"betas": [FALLBACK_BETA], "fallbacks": "default"} if self.model in FALLBACK_MODELS else {}
        try:
            with self._client.beta.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=messages,
                cache_control={"type": "ephemeral"},  # caches up to the newest message: the next turn reads it back
                output_config={"effort": self.effort},
                **extra,
            ) as stream:
                yield from stream.text_stream
                final = stream.get_final_message()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
            raise LLMError(f"API 키가 맞지 않거나 권한이 없습니다. ({error.status_code})", "auth") from error
        except anthropic.RateLimitError as error:
            raise LLMError("요청 한도를 넘었습니다. 잠시 뒤 다시 물어보세요.", "rate_limit") from error
        except anthropic.APIConnectionError as error:  # timeouts included
            raise LLMError("서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.", "network") from error
        except anthropic.BadRequestError as error:
            too_long = "too long" in str(error.message).lower()
            raise LLMError("보낸 내용이 너무 깁니다." if too_long else f"요청이 거부되었습니다: {error.message}",
                           "context_too_long" if too_long else "other") from error
        except anthropic.APIStatusError as error:
            raise LLMError(f"서버 오류입니다 ({error.status_code}). 잠시 뒤 다시 물어보세요.", "other") from error
        usage = final.usage
        log.info("answer: %s in, %s cached, %s out, stop %s", usage.input_tokens, usage.cache_read_input_tokens,
                 usage.output_tokens, final.stop_reason)
        if final.stop_reason == "refusal":
            raise LLMError("이 질문에는 답할 수 없다는 응답을 받았습니다.", "refused")
        cached = usage.cache_read_input_tokens or 0
        yield Usage(usage.input_tokens + cached + (usage.cache_creation_input_tokens or 0), cached, usage.output_tokens)
