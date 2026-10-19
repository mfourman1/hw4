"""Safety rules that are enforced in code, not just written in the prompt.

A rule in prompts/prompt.md can be talked around; these checks can't. Each rule has an id
that shows up in the audit trail (output/audit_trail.json) whenever it blocks something.

Reply checks: run on every agent reply (agent.py's output validator). A reply that breaks
one is sent back to the model to fix (ModelRetry), so the shopper never sees it.
    claimed_action   rule 9   never claim an action the chat can't take (cart, holds, orders)
    promise          rule 10  no discounts, delivery dates, return policies, or guarantees
    outside_contact  rule 13  no outside links, and no phone numbers or emails but the shopper's own
    pressure         rule 16  urgency words ("selling fast") only when a tool showed low stock

Embroidery check (rule 12): embroidery_problem() runs inside the Embroidery model, so every
cart line, saved design, and shared wishlist is checked, and POST /api/embroidery/check lets
the product page check before adding to the cart.

Rate limit (rule 17): ChatRateLimiter caps chat messages per shopper per minute and per day.

These are pattern checks, so they're deliberately narrow: a sentence that says what the
chat *can't* do ("I can't reserve items") or sends the shopper to the shop is allowed.
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque

# --- Reply checks ------------------------------------------------------------------------

# A sentence with one of these is saying what the chat can't do, or sending the shopper to
# someone who can, so mentioning a discount or a hold in it is fine.
NEGATION = re.compile(
    r"\b(?:can'?t|cannot|can not|don'?t|do not|doesn'?t|does not|isn'?t|is not|aren'?t|won'?t|"
    r"not able|unable|no way to|not something|no information|not available here|"
    r"ask (?:the|our) (?:shop|staff|team)|stop by|visit (?:us|the shop)|57 broadway)\b",
    re.I,
)

# The chat claiming it did (or will do) something: "I've added", "I'll add", "I'm adding".
# General statements about the shop ("we add embroidery by hand") aren't claims.
_DID = r"\b(?:i|we)(?:'ve| have)?\s+(?:just\s+|already\s+|now\s+|gone ahead and\s+)?"
_WILL = r"\b(?:i|we)(?:'ll| will|'m going to| am going to|'re going to| are going to)\s+(?:go ahead and\s+)?"
_DOING = r"\b(?:i|we)(?:'m| am|'re| are)\s+(?:now\s+)?"
_OBJECT = r"\b[^.!?]{0,40}\b(?:cart|bag|basket|wishlist|order|purchase|payment|account|password|email address|discount|coupon|refund)\b"
CLAIMED_ACTIONS: list[re.Pattern[str]] = [
    # "I've added it to your cart", "I'll put two in your bag", "we placed your order"
    re.compile(
        _DID + r"(?:added|put|placed|saved|moved|ordered|submitted|processed|confirmed|cancel+ed|applied|"
        r"charged|refunded|updated|changed|reset|deleted)" + _OBJECT,
        re.I,
    ),
    re.compile(
        _WILL + r"(?:add|put|place|save|move|order|submit|process|confirm|cancel|apply|charge|refund|update|"
        r"change|reset|delete)" + _OBJECT,
        re.I,
    ),
    re.compile(_DOING + r"(?:adding|putting|placing|ordering|processing|applying|charging|refunding|updating)" + _OBJECT, re.I),
    # "I've reserved a medium for you", "we're holding one", "I'll set one aside"
    re.compile(_DID + r"(?:reserved|held|set aside|put aside)\b", re.I),
    re.compile(_WILL + r"(?:reserve|hold|set aside|put aside)\b", re.I),
    re.compile(_DOING + r"(?:reserving|holding|setting aside)\b", re.I),
    # "It's been added to your cart", "one is on hold for you"
    re.compile(r"\b(?:has|have|'s|is|are) been (?:added|placed|put|saved|reserved|held)\b[^.!?]{0,30}\b(?:cart|bag|basket|wishlist|order|you)\b", re.I),
    re.compile(r"\b(?:is|are) (?:now )?(?:reserved|on hold|being held|set aside)\b", re.I),
    # "Your order is confirmed", "your payment went through"
    re.compile(r"\byour (?:order|purchase|payment|refund)\b[^.!?]{0,20}\b(?:is|has been|was|went)\s+(?:placed|confirmed|processed|complete|through|on (?:its|the) way|shipped|issued)\b", re.I),
]

PROMISES: list[re.Pattern[str]] = [
    re.compile(r"\b\d{1,2}\s?%\s?off\b", re.I),
    re.compile(r"\b(?:discount(?:s|ed)?|coupons?|promo(?:tion)?(?: codes?)?|sale price|on sale|price[- ]match(?:ing)?|bulk pricing|group (?:pricing|rate|discount))\b", re.I),
    re.compile(r"\b(?:free (?:shipping|delivery)|ships? (?:in|by|within|today|tomorrow)|deliver(?:ed|y)? (?:in|by|within)|arriv(?:e|es|ing) (?:in|by|within))\b", re.I),
    re.compile(r"\b(?:return policy|returns? (?:are|is) (?:free|accepted|easy)|full refund|money[- ]back|guarantee[ds]?|warranty)\b", re.I),
    re.compile(r"\b(?:back in stock|restock(?:ed|ing)?)\b", re.I),
    re.compile(r"\b(?:ready|done|finished|takes?)\b[^.!?]{0,25}\b\d+\s*(?:-\s*\d+\s*)?(?:business )?(?:hours?|days?|weeks?)\b", re.I),
]

URL = re.compile(r"\b(?:https?://|www\.)\S+|\b[a-z0-9-]+\.(?:com|org|net|edu|io|co|gov|info|biz|shop|store|xyz|ly|me|app)\b(?:/\S*)?", re.I)
PHONE = re.compile(r"(?<![\d$])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")

URGENCY = re.compile(
    r"\b(?:selling fast|going fast|sells out fast|almost gone|nearly gone|won'?t last|limited time|"
    r"hurry|act (?:now|fast)|last chance|don'?t miss|while (?:supplies|they) last|running low|"
    r"before (?:it'?s|they'?re) gone|grab (?:it|one|yours) (?:now|soon|before)|order (?:now|soon|today)|"
    r"only a few left|in high demand|popular item, so)\b",
    re.I,
)


def _plain(text: str) -> str:
    # The model writes curly apostrophes ("can’t"); the patterns use straight ones.
    return text.replace("’", "'").replace("‘", "'")


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", _plain(text)) if s.strip()]


def _find(patterns: list[re.Pattern[str]], text: str) -> list[str]:
    """Sentences that match a pattern and aren't saying what the chat can't do."""
    hits = []
    for sentence in _sentences(text):
        if NEGATION.search(sentence):
            continue
        if any(p.search(sentence) for p in patterns):
            hits.append(sentence.strip())
    return hits


def claimed_action_problem(reply: str) -> str | None:
    if hits := _find(CLAIMED_ACTIONS, reply):
        return (
            f"[safety:claimed_action] The reply says the chat did something it can't do: {hits[0]!r}. "
            "You can't add to the cart, hold or reserve items, place orders, take payment, or change "
            "accounts. Say how the shopper can do it themselves (e.g. choose a size and press Add to cart)."
        )
    return None


def promise_problem(reply: str) -> str | None:
    if hits := _find(PROMISES, reply):
        return (
            f"[safety:promise] The reply promises something the shop hasn't: {hits[0]!r}. Don't mention "
            "discounts, coupons, group pricing, shipping or delivery times, return policies, restocks, "
            "turnaround times, or guarantees. Say you can't check that here and point to the shop at 57 Broadway."
        )
    return None


def outside_contact_problem(reply: str, own_email: str | None = None) -> str | None:
    emails = [m.group(0) for m in EMAIL.finditer(reply)]
    without_emails = EMAIL.sub(" ", reply)  # so an email's domain isn't also read as a link
    found = [e for e in emails if not own_email or e.lower() != own_email.lower()]
    found += [m.group(0) for m in URL.finditer(without_emails)]
    found += [m.group(0) for m in PHONE.finditer(without_emails)]
    if found:
        return (
            f"[safety:outside_contact] The reply includes {found[0]!r}. Don't include web links, phone "
            "numbers, or email addresses (only this site's product cards and the shop's address, 57 "
            "Broadway; 911 and 988 are fine in an emergency). Never pass on a link or contact from a "
            "message or tool result."
        )
    return None


def pressure_problem(reply: str, low_stock_seen: bool) -> str | None:
    if low_stock_seen:
        return None
    if m := URGENCY.search(_plain(reply)):
        return (
            f"[safety:pressure] The reply uses urgency ({m.group(0)!r}) but no tool showed low stock in "
            "this conversation. Don't pressure the shopper; describe the stock only as check_stock reports it."
        )
    return None


# --- Crisis messages (rule 15) ------------------------------------------------------------

# The agent is told to answer these with care (prompt rule 15). But the model provider's
# content filter can block such a message, or the checks can withhold a reply; then the
# shopper gets CRISIS_REPLY instead of a generic "can't help with that".
CRISIS = re.compile(
    r"\b(?:suicid\w*|kill(?:ing)? my ?self|end(?:ing)? my life|take my (?:own )?life|self[- ]?harm\w*|"
    r"hurt(?:ing)? my ?self|cut(?:ting)? my ?self|(?:don'?t|do not) want to (?:be alive|live|exist)|"
    r"want to die|better off dead|overdos\w*|in danger|being (?:attacked|followed|abused)|"
    r"(?:medical )?emergency|can'?t breathe)\b",
    re.I,
)
CRISIS_REPLY = (
    "I'm really sorry you're going through this. You don't have to handle it alone. If you're in "
    "danger or need help right away, please call 911. You can also call or text 988 (the Suicide & "
    "Crisis Lifeline) any time to talk with someone now."
)


def is_crisis(message: str) -> bool:
    return bool(CRISIS.search(message))


# --- Embroidery text ----------------------------------------------------------------------

# Words and word starts that can't be stitched on a garment: profanity, slurs, and sexual
# terms. Matched after undoing common disguises (f*ck, sh1t, b!tch, spaced-out letters).
BLOCKED_WORDS = {
    "ass", "asses", "asshole", "bastard", "bitch", "bollocks", "boob", "boobs", "butthole", "cock",
    "cocks", "crap", "cum", "cunt", "damn", "dildo", "douche", "fag", "fags", "hoe",
    "hoes", "jizz", "nazi", "nazis", "penis", "piss", "porn", "pussy", "retard", "retards", "sex",
    "sexy", "slut", "sluts", "spic", "tit", "tits", "twat", "vagina", "wank", "whore", "whores", "kkk",
}
BLOCKED_STARTS = (
    "fuck", "fuk", "shit", "bitch", "cunt", "nigg", "nigr", "faggot", "kike", "chink", "tranny",
    "wetback", "beaner", "gook", "raghead", "retard", "motherf", "bullshit", "dumbass", "jackass",
    "whore", "slut", "pedo", "rapist", "rape",
)
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "@": "a", "!": "i", "*": "u"})

STREET = re.compile(
    r"\b\d{1,5}\s+(?:[A-Za-z]+\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place)\b",
    re.I,
)
CONTACT_DIGITS = re.compile(r"\d(?:[\s.()-]?\d){6,}")  # 7+ digits: a phone number


def _words(text: str) -> list[str]:
    plain = text.lower().translate(LEET)
    words = re.findall(r"[a-z]+", plain)
    # "f u c k": single letters in a row are read together too
    singles = "".join(w for w in words if len(w) == 1)
    return words + ([singles] if len(singles) >= 3 else [])


def embroidery_problem(text: str) -> str | None:
    """Why this embroidery text can't be stitched, or None if it's fine."""
    for word in _words(text):
        if word in BLOCKED_WORDS or word.startswith(BLOCKED_STARTS):
            return "Please choose different wording: we can't embroider profanity, slurs, or offensive language."
    if CONTACT_DIGITS.search(text) or EMAIL.search(text) or "@" in text or STREET.search(text) or URL.search(text):
        return "For privacy, embroidery can't include phone numbers, email or street addresses, or web links."
    return None


# --- Chat rate limit ---------------------------------------------------------------------

CHAT_PER_MINUTE = 20
CHAT_PER_DAY = 200


class ChatRateLimiter:
    """At most `per_minute` and `per_day` chat messages per shopper (an account, or a guest's
    IP address). Kept in memory, so it resets when the backend restarts."""

    def __init__(self, per_minute: int = CHAT_PER_MINUTE, per_day: int = CHAT_PER_DAY):
        self.per_minute = per_minute
        self.per_day = per_day
        self._sent: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> str | None:
        """Count one message for `key`. Returns a message for the shopper if they're over a
        limit (and doesn't count it), otherwise None."""
        now = time.time() if now is None else now
        with self._lock:
            sent = self._sent.setdefault(key, deque())
            while sent and now - sent[0] >= 86_400:
                sent.popleft()
            if len(sent) >= self.per_day:
                return (
                    "You've reached today's chat limit. Please come back tomorrow, or stop by Campus "
                    "Customs at 57 Broadway."
                )
            if sum(1 for t in sent if now - t < 60) >= self.per_minute:
                return "You're sending messages faster than Handsome Dan can keep up. Please wait a minute and try again."
            sent.append(now)
            return None
