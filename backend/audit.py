"""Append-only audit trail of agent-loop activity: output/audit_trail.json.

Every chat turn adds one record: when it ran, who asked (an account id or "guest", never a
name or email), which page they were on, each tool the agent called with short arguments and
a short result, every time a safety check sent a reply back, how many model requests and
tokens it used, and why the loop stopped. Safety blocks outside the agent loop (the chat rate
limit, blocked embroidery text) add records too.

The file is a JSON array that only grows. A new record is written over the closing "]" and
the "]" is put back after it, so earlier records are never rewritten, and nothing clears the
file between runs or restarts. The shopper's message text is not stored (guests' chats are
never saved, Problem 8); only its length and the kinds of sensitive detail removed from it.

Stop reasons
    final_answer      the agent returned its reply
    content_filter    the model provider's content filter blocked the message
    safety_fallback   a safety or number check kept rejecting the reply until retries ran out,
                      so the shopper got a safe fallback message instead
    usage_limit       the turn hit RUN_LIMITS (model requests or tokens) and was stopped
    error             the model or network failed (the shopper got an error message)
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)

AUDIT_PATH = Path(__file__).resolve().parent.parent / "output" / "audit_trail.json"
SHORT = 80  # characters kept from any one argument or result
OUTPUT_TOOL = "final_result"  # PydanticAI's tool for the structured reply (not a lookup)

_lock = threading.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _short(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value  # numbers stay numbers
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= SHORT else text[: SHORT - 1] + "…"


def append(record: dict[str, Any], path: Path | None = None) -> None:
    """Add one record to the end of the JSON array, without rewriting earlier records."""
    path = path or AUDIT_PATH
    line = json.dumps(record, ensure_ascii=False, default=str)
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.stat().st_size == 0:
            path.write_text(f"[\n{line}\n]\n", encoding="utf-8")
            return
        with open(path, "r+b") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            back = min(size, 4096)
            f.seek(size - back)
            tail = f.read(back)
            end = tail.rfind(b"]")
            if end == -1:
                raise ValueError(f"{path} is not a JSON array; not appending to it")
            empty = tail[:end].rstrip().endswith(b"[")
            f.seek(size - back + end)
            f.write(((b"\n" if empty else b",\n") + line.encode("utf-8") + b"\n]\n"))
            f.truncate()


# --- Summaries of tool calls and results ---------------------------------------------------


def _result_summary(tool: str, content: Any) -> str:
    """A short, readable version of what a tool returned."""
    if isinstance(content, list):
        ids = [getattr(item, "product_id", None) for item in content]
        ids = [i for i in ids if i]
        listed = ", ".join(ids[:3]) + ("…" if len(ids) > 3 else "")
        return _short(f"{len(content)} result{'s' if len(content) != 1 else ''}" + (f": {listed}" if listed else ""))
    if isinstance(content, BaseModel):
        data = content.model_dump()
        if tool == "get_price":
            return f"{data['product_id']}: ${data['price']:.2f}"
        if tool == "check_stock":
            asked = (
                f"{data['requested_size']}: {data['requested_size_quantity']} ({data['requested_size_status']}); "
                if data.get("requested_size")
                else ""
            )
            return _short(f"{asked}in stock: {','.join(data['available_sizes']) or 'none'}; total {data['total_in_stock']}")
        if tool == "recommend_size":
            return _short(
                f"{data['recommended_size']} ({data['recommended_size_status']}, {data['recommended_size_quantity']}); "
                f"{data['reason']}"
            )
        if tool == "get_product_description":
            return _short(f"{data['product_id']}: {data['description']}")
        return _short(data)
    return _short(content)


def _rule(text: str) -> str:
    # Safety retries start with "[safety:<rule>]" (safety.py and agent.py).
    if text.startswith("[safety:") and "]" in text:
        return text[len("[safety:") : text.index("]")]
    return "output_validation"


def turn_record(
    *,
    turn: str,
    started: str,
    meta: dict[str, Any],
    messages: list[ModelMessage],
    stop_reason: str,
    duration_ms: int,
    reply: Any = None,
    error: str | None = None,
) -> dict[str, Any]:
    """One chat turn, from the messages the agent loop produced (only this turn's)."""
    calls: dict[str, ToolCallPart] = {}
    steps: list[dict[str, Any]] = []
    safety: list[dict[str, Any]] = []
    requests = 0
    tokens = {"input": 0, "output": 0}
    finish = None

    for message in messages:
        if isinstance(message, ModelResponse):
            requests += 1
            usage = getattr(message, "usage", None)
            tokens["input"] += getattr(usage, "input_tokens", 0) or 0
            tokens["output"] += getattr(usage, "output_tokens", 0) or 0
            finish = getattr(message, "finish_reason", None) or finish
            for part in message.parts:
                if isinstance(part, ToolCallPart):
                    calls[part.tool_call_id] = part
        elif isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, ToolReturnPart) and part.tool_name != OUTPUT_TOOL:
                    call = calls.get(part.tool_call_id)
                    args = call.args_as_dict() if call else {}
                    steps.append({
                        "time": part.timestamp.isoformat(timespec="milliseconds"),
                        "tool": part.tool_name,
                        "args": {k: _short(v) for k, v in args.items()},
                        "result": _result_summary(part.tool_name, part.content),
                    })
                elif isinstance(part, RetryPromptPart):
                    text = part.content if isinstance(part.content, str) else json.dumps(part.content, default=str)
                    if part.tool_name and part.tool_name != OUTPUT_TOOL and not text.startswith("[safety:"):
                        # A lookup tool sent the model back (e.g. an unknown product_id).
                        call = calls.get(part.tool_call_id)
                        steps.append({
                            "time": part.timestamp.isoformat(timespec="milliseconds"),
                            "tool": part.tool_name,
                            "args": {k: _short(v) for k, v in (call.args_as_dict() if call else {}).items()},
                            "result": _short(f"retry: {text}"),
                        })
                    else:
                        # The reply was sent back by a safety or number check.
                        safety.append({
                            "time": part.timestamp.isoformat(timespec="milliseconds"),
                            "rule": _rule(text),
                            "action": "reply sent back to the model to fix",
                            "detail": _short(text.split("] ", 1)[-1]),
                        })

    record: dict[str, Any] = {
        "time": started,
        "event": "chat_turn",
        "turn": turn,
        **meta,
        "steps": steps,
        "safety": safety,
        "model_requests": requests,
        "tokens": tokens,
        "model_finish_reason": finish,
        "stop_reason": stop_reason,
        "duration_ms": duration_ms,
    }
    if reply is not None:
        record["reply_chars"] = len(reply.reply)
        record["cards"] = [p.product_id for p in reply.products][:5]
        record["show_on_page"] = reply.show_on_page
    if error:
        record["error"] = _short(error)
    return record


def safety_event(rule: str, action: str, **details: Any) -> None:
    """A safety block outside the agent loop (rate limit, embroidery text)."""
    append({"time": now(), "event": "safety", "rule": rule, "action": action, **{k: _short(v) for k, v in details.items()}})
