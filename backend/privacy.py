"""Hide sensitive details in chat before they are saved or sent to the AI model.

A shopper might type a card number ("can you put it on 4111 1111 1111 1111?") or a
password. The shop never needs these in chat, so main.py runs every chat message through
redact() first. The model only ever sees "[card number removed]", the saved history only
stores the cleaned text, and the chat panel shows the shopper what was removed.

What is removed
    card number            any run of 13-19 digits (spaces or dashes allowed)
    card security code     3-4 digits after "CVV", "CVC", "CSC", or "security code"
    Social Security number 123-45-6789, or 9 digits after "SSN" / "social security"
    password               the word after "password is", "password:", "pw =", ...
    bank account number    digits after "account number", "routing number", "acct #", ...
    phone number           US formats: 203-555-0142, (203) 555-0142, +1 203.555.0142

Checked by evals/privacy_eval.py, which also makes sure ordinary shopping text (prices,
sizes, quantities, years, "Class of 2027") is left alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from tools import get_db


@dataclass
class Redacted:
    text: str
    removed: list[str] = field(default_factory=list)  # kinds removed, e.g. ["card number"]


# (kind, pattern, replacement). Order matters: long digit runs are taken as card numbers
# before the phone check can see parts of them. Labelled patterns keep their label.
RULES: list[tuple[str, re.Pattern[str], str]] = [
    ("card number",
     re.compile(r"(?<![\d$.,])\d(?:[ -]?\d){12,18}(?![\d.,])"),
     "[card number removed]"),
    ("card security code",
     re.compile(r"\b(cvv2?|cvc2?|csc|security code)(\s*(?:is|:|#|=)?\s*)\d{3,4}\b", re.I),
     r"\1\2[security code removed]"),
    ("Social Security number",
     re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
     "[SSN removed]"),
    ("Social Security number",
     re.compile(r"\b(ssn|social security(?: number)?)(\s*(?:is|:|#|=)?\s*)\d{9}\b", re.I),
     r"\1\2[SSN removed]"),
    ("password",
     # (?!\[) skips a password that was already replaced, so cleaning twice changes nothing.
     re.compile(r"\b(password|passcode|pass code|pwd|pw)(\s*(?:is|:|=)\s*)(?!\[)\S+?(?=[,;.!?]*(?:\s|$))", re.I),
     r"\1\2[password removed]"),
    ("bank account number",
     re.compile(r"\b((?:bank )?account|acct|routing)(\s*(?:number|no\.?|#)?\s*(?:is|:|=)?\s*)\d[\d -]{4,}\d\b", re.I),
     r"\1\2[account number removed]"),
    ("phone number",
     re.compile(r"(?<![\d$])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?!\d)|(?<![\d$])\d{10}(?!\d)"),
     "[phone number removed]"),
]


def redact(text: str) -> Redacted:
    """Return the text with sensitive details replaced, and which kinds were found."""
    removed: list[str] = []
    for kind, pattern, replacement in RULES:
        text, count = pattern.subn(replacement, text)
        if count and kind not in removed:
            removed.append(kind)
    return Redacted(text, removed)


def scrub_saved_chats() -> int:
    """Clean chat history saved before this check existed. Returns how many rows changed."""
    changed = 0
    with get_db() as con:
        rows = con.execute("SELECT id, content FROM chat_messages WHERE role = 'user'").fetchall()
        for row in rows:
            clean = redact(row["content"])
            if clean.removed:
                con.execute("UPDATE chat_messages SET content = ? WHERE id = ?", (clean.text, row["id"]))
                changed += 1
    return changed
