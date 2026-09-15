import logging
import queue
import re
import threading
import time

from app.config import get_settings

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

# Verified working models (streaming + non-streaming) for this API key, in
# priority order. The first model that answers is used; the rest are fallbacks.
# gemini-2.0-flash has no free-tier quota on this key (limit 0) and
# gemma-4-4b-it returns 404 NOT_FOUND — both are deliberately excluded.
#
# Latency note (measured): gemma-4-26b-a4b-it is correct but slow — ~35s to
# first token on this key. gemini-3.6-flash is ~1.9s and gemini-3.5-flash-lite
# is ~0.8s, both verified to produce full, valid plant-care answers. The fast
# models are tried first so the user sees output immediately; gemma is kept as
# a fallback only for an actual provider failure, never when a stream already
# produced valid text.
_DEFAULT_MODEL_CHAIN = [
    "gemini-3.5-flash-lite",   # primary (~0.8s first token, verified)
    "gemini-3.6-flash",        # verified fallback (~1.9s)
    "gemma-4-26b-a4b-it",      # verified fallback (~35s, kept for resilience)
]

_SYSTEM_PROMPT = (
    "You are the RAYY smart-irrigation assistant, an expert in irrigation and plant care. "
    "Answer the user's plant-care question using relevant knowledge and the supplied context when available. "
    "If context is available, use it for plant-specific facts. "
    "Do not claim that context is missing when the question is a general plant-care question. "
    "Be concise, practical, and clear. "
    "Do not invent measurements, diagnoses, or sensor readings."
)

_FALLBACK_REPLY = (
    "I'm RAYY — your smart irrigation assistant! I can help with irrigation and plant care questions.\n\n"
    "To enable AI-powered responses, add your GEMINI_API_KEY to backend/.env.\n"
    "Get a free key at https://aistudio.google.com/apikey\n\n"
    "In the meantime, here are some general tips:\n"
    "- Water when the top inch of soil feels dry\n"
    "- Most plants prefer 6+ hours of indirect sunlight\n"
    "- Check leaves weekly for spots, yellowing, or wilting\n"
    "- Maintain humidity between 40-60% for tropical plants"
)


def _model_chain() -> list[str]:
    raw = settings.gemini_chat_models.strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    return _DEFAULT_MODEL_CHAIN


def _build_prompt(context: str, message: str) -> str:
    return f"Context:\n{context}\n\nUser question: {message}"


def _retry_delay_seconds(exc: Exception) -> float:
    match = re.search(r"retry in ([\d.]+)s", str(exc), re.I)
    if match:
        return min(float(match.group(1)) + 0.5, 60.0)
    return 3.0


def _is_rate_limited(exc: Exception) -> bool:
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower()


def _is_transient(exc: Exception) -> bool:
    msg = str(exc)
    return any(
        token in msg
        for token in ("503", "500", "UNAVAILABLE", "INTERNAL", "high demand")
    )


def _build_config():
    """Build the shared GenerateContentConfig.

    Deliberately avoids max_output_tokens: the streaming endpoint returns no
    text when that field is set, and a capped reply would silently break the
    chat. The system prompt is kept short instead to reduce input latency.
    """
    from google.genai import types

    return types.GenerateContentConfig(system_instruction=_SYSTEM_PROMPT)


# Bound each upstream call (milliseconds). The SDK's default read timeout is
# 10 minutes, which turns a stalled upstream connection into a hung chat
# request instead of a retryable failure.
_READ_TIMEOUT_MS = 90_000


def _make_client():
    """Create the Gemini client with a bounded request timeout."""
    from google import genai
    from google.genai import types

    try:
        return genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=_READ_TIMEOUT_MS),
        )
    except TypeError:  # pragma: no cover - older SDK builds without HttpOptions
        return genai.Client(api_key=settings.gemini_api_key)


def _call_model(client, model_id: str, prompt: str) -> str:
    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=_build_config(),
    )
    return response.text or ""


def _generate_with_fallback(client, prompt: str) -> str:
    last_error: Exception | None = None

    for model_id in _model_chain():
        max_attempts = 2 if model_id == _model_chain()[0] else 1
        for attempt in range(max_attempts):
            try:
                text = _call_model(client, model_id, prompt)
                if text.strip():
                    if model_id != _model_chain()[0]:
                        logger.info("Chat reply served by fallback model: %s", model_id)
                    return text
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Model %s failed (attempt %s/%s): %s",
                    model_id,
                    attempt + 1,
                    max_attempts,
                    exc,
                )
                if _is_rate_limited(exc):
                    break
                if _is_transient(exc) and attempt + 1 < max_attempts:
                    time.sleep(_retry_delay_seconds(exc))
                    continue
                break

    return _busy_message(last_error)


def _busy_message(last_error: Exception | None) -> str:
    """Final reply when every model attempt failed. States the real reason."""
    if last_error is None:
        return "The AI service is temporarily unavailable. Please try again shortly."
    if _is_rate_limited(last_error):
        wait = int(_retry_delay_seconds(last_error))
        return (
            "The AI model is rate-limited right now. "
            f"Please wait about {wait} seconds and try again."
        )
    if _is_transient(last_error):
        return (
            "The AI model returned a temporary server error. "
            "Please try again in a minute."
        )
    return "The AI service could not be reached. Please try again shortly."


def get_chat_reply(context: str, message: str) -> str:
    if not settings.gemini_api_key:
        return _FALLBACK_REPLY

    client = _make_client()
    return _generate_with_fallback(client, _build_prompt(context, message))


def _stream_once(client, model_id: str, prompt: str, config):
    """Yield stream chunks; raise if the stream produced no content at all."""
    got_any = False
    for chunk in client.models.generate_content_stream(
        model=model_id,
        contents=prompt,
        config=config,
    ):
        if chunk.text:
            got_any = True
            yield chunk.text
    if not got_any:
        raise RuntimeError("stream produced no content")


# Measured on this key: gemini-3.5-flash-lite normally delivers its first token
# in ~0.8-1.7s, but the free tier intermittently accepts the request (HTTP 200)
# and then sends nothing at all for ~18s before the first chunk. Rather than wait
# that out, a model that has produced no first token within this deadline is
# abandoned and the next model in the chain is started immediately. Only the
# FIRST token is deadline-bound: once a model begins answering it owns the
# stream, however slow its later tokens are.
#
# The fallback deadline is deliberately larger than the primary one: measured
# first-token latency for gemini-3.6-flash on this key is ~3.4-4.1s, so applying
# the 3s primary deadline to it would abandon a perfectly healthy fallback and
# cascade onwards - straight into the slow path this exists to avoid.
_PRIMARY_FIRST_TOKEN_DEADLINE_S = 3.0
_FALLBACK_FIRST_TOKEN_DEADLINE_S = 8.0


def _pump_stream(events: "queue.Queue", model_id: str, client, prompt: str, config) -> None:
    """Run one model's stream in a thread, forwarding its events to a queue."""
    try:
        for text in _stream_once(client, model_id, prompt, config):
            events.put(("chunk", text))
    except Exception as exc:  # forwarded to the consumer, which owns the handling
        events.put(("error", exc))
    else:
        events.put(("done", None))


def _open_stream(client, model_id: str, prompt: str, config) -> "queue.Queue":
    """Start one model's stream and return the queue its events arrive on."""
    events: "queue.Queue" = queue.Queue()
    threading.Thread(
        target=_pump_stream,
        args=(events, model_id, client, prompt, config),
        name=f"gemini-stream-{model_id}",
        daemon=True,
    ).start()
    return events


def stream_chat_reply(context: str, message: str):
    if not settings.gemini_api_key:
        yield _FALLBACK_REPLY
        return

    client = _make_client()
    prompt = _build_prompt(context, message)
    config = _build_config()
    last_error: Exception | None = None
    started = time.perf_counter()
    fallovers: list[str] = []

    # Strict failover, one model at a time: the primary model is always tried
    # first, and the next model is only started once the current one has failed
    # or blown the first-token deadline. Models are never started in parallel.
    for index, model_id in enumerate(_model_chain()):
        deadline = (
            _PRIMARY_FIRST_TOKEN_DEADLINE_S if index == 0 else _FALLBACK_FIRST_TOKEN_DEADLINE_S
        )
        events = _open_stream(client, model_id, prompt, config)

        try:
            # Only the first token is deadline-bound. A model that has started
            # answering keeps this stream even if its later tokens are slow.
            kind, payload = events.get(timeout=deadline)
        except queue.Empty:
            last_error = TimeoutError(
                f"{model_id} produced no first token within {deadline:.1f}s"
            )
            logger.warning(
                "No first token from %s within %.1fs - failing over to the next model",
                model_id,
                deadline,
            )
            fallovers.append(model_id)
            continue

        if kind != "chunk":
            last_error = payload if kind == "error" else RuntimeError(
                f"{model_id} produced no content"
            )
            logger.warning("Stream model %s failed before its first token: %s", model_id, last_error)
            fallovers.append(model_id)
            continue

        # This model produced the first token the user sees: keep its stream.
        logger.info(
            "Chat stream served by %s (first token in %.2fs, failed over from %s)",
            model_id,
            time.perf_counter() - started,
            ",".join(fallovers) or "none",
        )
        yield payload

        while True:
            kind, payload = events.get()
            if kind == "chunk":
                yield payload
            elif kind == "error":
                # Text is already on screen: another model would duplicate it.
                logger.warning(
                    "Stream from %s ended early; keeping partial output: %s", model_id, payload
                )
                return
            else:
                logger.info(
                    "Chat stream finished in %.2fs via %s",
                    time.perf_counter() - started,
                    model_id,
                )
                return

    # Streaming is unavailable for every model right now. The non-streaming
    # path over the same chain is verified to work — use it so the user still
    # gets a real AI answer instead of nothing.
    if last_error is not None and not _is_rate_limited(last_error):
        try:
            text = _generate_with_fallback(client, prompt)
            if text.strip():
                yield text
                return
        except Exception as exc:
            logger.warning("Non-streaming fallback also failed: %s", exc)
            last_error = exc

    logger.error("Chat stream failed after all models; last error: %s", last_error)
    yield _busy_message(last_error)
