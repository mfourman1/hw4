"""Test set for privacy.redact(): sensitive details must go, shopping text must stay.

Run from the backend/ folder:

    python evals/privacy_eval.py

Exits with status 1 if any case fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from privacy import redact  # noqa: E402

# (message, kinds that must be removed, text that must NOT survive)
SENSITIVE = [
    ("Can you put it on 4111 1111 1111 1111?", ["card number"], "4111"),
    ("card 4111-1111-1111-1111 exp 12/27", ["card number"], "1111-1111"),
    ("my amex is 378282246310005", ["card number"], "378282246310005"),
    ("the cvv is 123", ["card security code"], "123"),
    ("Security code: 9876", ["card security code"], "9876"),
    ("my SSN is 123-45-6789", ["Social Security number"], "6789"),
    ("social security number 123456789", ["Social Security number"], "123456789"),
    ("my password is bulldog2026, can you log me in?", ["password"], "bulldog2026"),
    ("Password: Hunter2!", ["password"], "Hunter2"),
    ("routing number 021000021", ["bank account number"], "021000021"),
    ("Text me at 203-555-0142", ["phone number"], "555-0142"),
    ("call (203) 555-0142 when it's in", ["phone number"], "555-0142"),
    ("my cell is +1 203.555.0142", ["phone number"], "555.0142"),
    ("2035550142 is my number", ["phone number"], "2035550142"),
    ("Pay with 4111 1111 1111 1111 and text 203-555-0142", ["card number", "phone number"], "0142"),
]

# Ordinary shopping messages: nothing should be removed or changed.
SAFE = [
    "How much is the $68 hoodie?",
    "Do you have the Pierson crewneck in XL? I need 2.",
    "Embroider Class of 2027 on the right chest",
    "Is anything under $100.00?",
    "I want 10 shirts for our club of 25 people",
    "The 2025 Yale vs Harvard tee please",
    "Our shop is at 57 Broadway, New Haven CT 06511",
    "I'll come by on 10/18/2026",
    "Is the hoodie 50% cotton?",
    "I forgot my password, how do I reset it?",
    "What's in my account?",
    "Show me size M and L",
]


def main() -> int:
    failures = 0
    print("Sensitive messages")
    for message, kinds, secret in SENSITIVE:
        result = redact(message)
        ok = sorted(result.removed) == sorted(kinds) and secret not in result.text
        failures += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {message!r}\n        -> {result.text!r}  {result.removed}")
    print("\nOrdinary messages (must be unchanged)")
    for message in SAFE:
        result = redact(message)
        ok = result.text == message and not result.removed
        failures += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {message!r}" + ("" if ok else f"\n        -> {result.text!r}"))
    print("\nCleaning twice changes nothing (saved history is re-checked at every start)")
    for message, _, _ in SENSITIVE:
        once = redact(message).text
        twice = redact(once)
        ok = twice.text == once and not twice.removed
        failures += not ok
        if not ok:
            print(f"  FAIL  {once!r}\n        -> {twice.text!r}")
    print(f"  {'PASS' if failures == 0 else 'see failures above'}  all {len(SENSITIVE)} cleaned messages")
    total = len(SENSITIVE) * 2 + len(SAFE)
    print(f"\n{total - failures}/{total} checks pass "
          f"({len(SENSITIVE)} sensitive, {len(SAFE)} ordinary, {len(SENSITIVE)} clean-twice)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
