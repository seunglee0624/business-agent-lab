"""AI chat backends. Pure Python; Qt only in worker.py."""
from app.core.llm.anthropic_api import AnthropicBackend
from app.core.llm.openai_compat import OpenAICompatBackend


def make_backend(config):
    """The backend the settings choose. config: core.settings.llm_config()."""
    if config["backend"] == "openai_compat":
        return OpenAICompatBackend(config["openai_base_url"], config["openai_key"], config["openai_model"],
                                   config["max_tokens"])
    return AnthropicBackend(config["anthropic_model"], config["anthropic_effort"], config["max_tokens"],
                            api_key=config["anthropic_key"])
