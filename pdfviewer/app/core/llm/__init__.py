"""AI chat backends. Pure Python; Qt only in worker.py."""
from app.core.llm.anthropic_api import AnthropicBackend


def make_backend(config):
    """The backend the settings choose. config: core.settings.llm_config()."""
    return AnthropicBackend(config["model"], config["effort"], config["max_tokens"])
