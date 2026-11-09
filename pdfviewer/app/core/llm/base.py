"""What every AI backend offers. Pure Python: the chat state and the widgets only ever see this."""

KINDS = ("auth", "rate_limit", "network", "context_too_long", "refused", "other")


class LLMError(Exception):
    """A failed answer. kind (one of KINDS) picks the advice shown to the user; the message says what happened."""

    def __init__(self, message, kind="other"):
        super().__init__(message)
        self.kind = kind


class LLMBackend:
    name = ""
    model = ""

    def is_available(self):
        """False when the backend cannot work at all (e.g. no API key), so the panel can say so up front."""
        raise NotImplementedError

    def stream(self, system, messages):
        """Yield the answer's text as it arrives. messages: [{"role": "user" | "assistant", "content": str}].
        Raises LLMError."""
        raise NotImplementedError
