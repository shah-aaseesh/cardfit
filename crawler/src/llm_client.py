"""
llm_client.py — thin abstraction over free-tier LLM providers.

classify.py and extract.py call complete_json() and don't need to know or
care whether it's backed by Gemini or Groq. Switching providers is a
single env var (LLM_PROVIDER=gemini|groq) — no code changes elsewhere.

Free tiers are rate-limited per minute (e.g. Gemini Flash-Lite is roughly
15 requests/minute as of mid-2026, though Google has changed these limits
more than once — check https://ai.google.dev/gemini-api/docs/rate-limits
for the current number rather than trusting any hardcoded figure,
including this comment). Two things protect you from that:
  1. settings.llm_call_delay_s paces calls proactively.
  2. This module retries with backoff on 429s as a safety net for whatever
     the actual current limit is.
"""
import json
import logging
import time

from src.config import settings

logger = logging.getLogger("llm_client")

_gemini_client = None
_groq_client = None
_openai_client = None
_xai_client = None

# Running tally for the pipeline's provider-health check. classify.py and
# extract.py swallow LLM errors so one bad page can't sink a run — which
# also means a dead key or exhausted quota would otherwise look like "the
# issuer has no cards". pipeline.py reads and resets this per provider.
stats = {"calls": 0, "failures": 0, "last_error": None}


def reset_stats() -> None:
    stats.update(calls=0, failures=0, last_error=None)


def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not set — get a free key at https://aistudio.google.com/apikey")
        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        from groq import Groq
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set — get a free key at https://console.groq.com/keys")
        _groq_client = Groq(api_key=settings.groq_api_key)
    return _groq_client


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set — create one at https://platform.openai.com/api-keys")
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_xai_client():
    """xAI (Grok) speaks the OpenAI API at its own base URL."""
    global _xai_client
    if _xai_client is None:
        from openai import OpenAI
        if not settings.xai_api_key:
            raise RuntimeError("XAI_API_KEY not set — create one at https://console.x.ai")
        _xai_client = OpenAI(api_key=settings.xai_api_key, base_url="https://api.x.ai/v1")
    return _xai_client


def _call_gemini(prompt: str, model: str, max_tokens: int) -> str:
    client = _get_gemini_client()
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config={
            "max_output_tokens": max_tokens,
            "temperature": 0,  # deterministic-ish output for structured extraction
            "response_mime_type": "application/json",  # ask Gemini to return valid JSON directly
        },
    )
    return response.text


def _call_groq(prompt: str, model: str, max_tokens: int) -> str:
    client = _get_groq_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


def _call_openai(prompt: str, model: str, max_tokens: int) -> str:
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=0,
        response_format={"type": "json_object"},  # guaranteed valid JSON
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


def _call_xai(prompt: str, model: str, max_tokens: int) -> str:
    client = _get_xai_client()
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


def complete_json(prompt: str, model: str | None = None, max_tokens: int = 500) -> dict:
    """Sends `prompt` to the configured free LLM provider, expects a JSON
    object back, and returns it parsed. Retries with backoff on rate-limit
    errors. Raises on unrecoverable failure — callers should catch and
    degrade gracefully (see classify.py / extract.py)."""
    model = model or settings.classify_model
    provider = settings.llm_provider
    stats["calls"] += 1

    last_error = None
    for attempt in range(settings.llm_max_retries):
        try:
            if provider == "gemini":
                raw = _call_gemini(prompt, model, max_tokens)
            elif provider == "groq":
                raw = _call_groq(prompt, model, max_tokens)
            elif provider == "openai":
                raw = _call_openai(prompt, model, max_tokens)
            elif provider == "xai":
                raw = _call_xai(prompt, model, max_tokens)
            else:
                raise ValueError(f"unknown LLM_PROVIDER '{provider}' — expected 'gemini', 'groq', 'openai' or 'xai'")

            time.sleep(settings.llm_call_delay_s)  # proactive pacing for free-tier RPM limits

            cleaned = raw.strip().replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)

        except json.JSONDecodeError as e:
            logger.warning(f"non-JSON response from {provider} (attempt {attempt + 1}): {e}")
            last_error = e
            # don't retry parse failures with the same prompt — unlikely to self-correct
            break

        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "429" in err_str or "rate" in err_str or "quota" in err_str or "resource_exhausted" in err_str
            last_error = e
            if is_rate_limit and attempt < settings.llm_max_retries - 1:
                backoff = settings.llm_call_delay_s * (2 ** (attempt + 1))
                logger.warning(f"{provider} rate limited (attempt {attempt + 1}), backing off {backoff:.0f}s")
                time.sleep(backoff)
                continue
            logger.error(f"{provider} call failed: {e}")
            break

    stats["failures"] += 1
    stats["last_error"] = str(last_error)[:300]
    raise RuntimeError(f"LLM call failed after {settings.llm_max_retries} attempts: {last_error}")
