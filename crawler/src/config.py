"""
config.py — central settings and config loading.

Loads provider list from config/providers.yaml and environment variables
from .env (see .env.example). Keeping this in one place means every other
module just does `from src.config import settings` instead of re-reading
files everywhere.
"""
import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
import yaml
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
LOG_DIR = ROOT / "logs"

DATA_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)


def _default_model() -> str:
    """Sensible default extraction model per provider's tier."""
    provider = os.getenv("LLM_PROVIDER", "gemini")
    if provider == "gemini":
        return "gemini-2.5-flash-lite"
    if provider == "openai":
        return "gpt-4o-mini"
    if provider == "xai":
        # Cheap, fast Grok tier; override with EXTRACT_MODEL / CLASSIFY_MODEL
        # if the account lists a different name at GET /v1/models.
        return "grok-3-mini"
    return "llama-3.3-70b-versatile"  # groq


@dataclass
class Settings:
    # Which LLM backend to use: "gemini", "groq", "openai" or "xai" (Grok,
    # OpenAI-compatible API; paid, needs account credits). Gemini/Groq
    # have free tiers; OpenAI is paid (pay-as-you-go) and is the best pick for
    # a one-time high-quality backfill (e.g. gpt-4o-mini, ~$0.30 for a full
    # crawl) before switching back to a free provider for cheap re-checks.
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "gemini"))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    groq_api_key: str = field(default_factory=lambda: os.getenv("GROQ_API_KEY", ""))
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))
    xai_api_key: str = field(default_factory=lambda: os.getenv("XAI_API_KEY", ""))
    slack_webhook_url: Optional[str] = field(default_factory=lambda: os.getenv("SLACK_WEBHOOK_URL"))

    # Supabase (Postgres) — when both are set, storage.py publishes accepted
    # records to the `cards` table in addition to the local JSON files.
    # SUPABASE_SERVICE_KEY must be the service_role key (not anon) since
    # writes need to bypass RLS — never expose this key to the frontend.
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", ""))
    supabase_service_key: str = field(default_factory=lambda: os.getenv("SUPABASE_SERVICE_KEY", ""))

    # crawling behavior
    request_timeout_s: int = int(os.getenv("REQUEST_TIMEOUT_S", "15"))
    request_delay_s: float = float(os.getenv("REQUEST_DELAY_S", "1.5"))  # politeness delay between requests
    max_urls_per_provider: int = int(os.getenv("MAX_URLS_PER_PROVIDER", "60"))
    user_agent: str = os.getenv(
        "CRAWLER_USER_AGENT",
        "CardCompareBot/1.0 (+https://example.com/bot; contact=admin@example.com)",
    )

    # classification / extraction models — defaults chosen per provider's free tier
    classify_model: str = os.getenv("CLASSIFY_MODEL", _default_model())
    extract_model: str = os.getenv("EXTRACT_MODEL", _default_model())
    # LLM call pacing — free tiers are rate-limited per minute (e.g. Gemini
    # Flash-Lite: ~15 RPM). This delay is applied between LLM calls specifically,
    # separate from request_delay_s which paces HTTP fetches of issuer pages.
    llm_call_delay_s: float = float(
        os.getenv("LLM_CALL_DELAY_S", "0.3" if os.getenv("LLM_PROVIDER", "gemini") in ("openai", "xai") else "4.5")
    )
    llm_max_retries: int = int(os.getenv("LLM_MAX_RETRIES", "3"))

    # Headless-browser rendering (providers with render_js: true). Optional —
    # needs `pip install playwright && playwright install chromium`.
    render_timeout_ms: int = int(os.getenv("RENDER_TIMEOUT_MS", "30000"))
    render_scroll_steps: int = int(os.getenv("RENDER_SCROLL_STEPS", "8"))
    render_settle_ms: int = int(os.getenv("RENDER_SETTLE_MS", "1200"))

    # validation thresholds
    max_annual_fee: float = 1000.0
    max_apr: float = 40.0
    min_apr: float = 0.0
    reject_rate_alert_threshold: float = 0.20  # alert if >20% of pages rejected

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)

    def load_providers(self) -> list[dict]:
        with open(CONFIG_DIR / "providers.yaml") as f:
            raw = yaml.safe_load(f)
        return [p for p in raw["providers"] if p.get("enabled", True)]


settings = Settings()
