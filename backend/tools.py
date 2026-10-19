"""Settings, database access, and the tools the Campus Customs chat agent can call.

Tools (registered on the agent in agent.py). Every one reads data/campus_customs.db.
    search_products           find catalogue items that match what the shopper is asking for
    get_product_description   full catalogue text for one product
    get_price                 current price for one product
    check_stock               units in stock for one product, by size (and one size if asked)
    recommend_size            (sizing.py) which size to get, from the size chart, and its stock
    similar_in_stock          (recommend.py) similar items that are in stock in a sold-out size

Helpers used by the agent and main.py
    get_db, ensure_schema, product_cards, image_url, short_description, normalize_size,
    make_model, system_prompt
    customer_info, resolve_page            build the agent's deps (who is chatting, which page)
    load_chat_history, saved_chat_messages, save_chat_turn   logged-in shoppers' chat history
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic_ai import ModelRetry
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from models import (
    MAX_CHAT_CARDS,
    MAX_PAGE_RESULTS,
    ChatHistoryMessage,
    ChatReply,
    CustomerInfo,
    PageContext,
    PageInfo,
    PageType,
    ProductCard,
    ProductDescription,
    ProductMatch,
    ProductPrice,
    SizeStock,
    StockReport,
    StockStatus,
)

# --- Settings: paths, model, and the Portkey connection ---------------------------------
# Every backend file reads its settings from here, so paths and model names live in one place.

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = BACKEND_DIR.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "campus_customs.db"
PRODUCT_IMAGES_DIR = DATA_DIR / "products"
# Copies of photos whose black side bars were filled white (made by scripts/clean_photos.py).
PRODUCT_IMAGES_CLEAN_DIR = DATA_DIR / "products_clean"
PROMPT_PATH = BACKEND_DIR / "prompts" / "prompt.md"

# The API key is the same PORTKEY_API_KEY used in Homework 3. It is read from the environment,
# or from a local .env file (never committed) in backend/ or the hw4 folder (copy .env.example).
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(ROOT / ".env")
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

PORTKEY_BASE_URL = "https://api.portkey.ai/v1"
DEFAULT_MODEL = "gpt-5.6-luna"

SHORT_DESCRIPTION_CHARS = 90
DEFAULT_SEARCH_RESULTS = 5
MAX_SEARCH_RESULTS = MAX_PAGE_RESULTS  # a browsing search can fill the page
SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"]
LOW_STOCK = 5  # same "Only N left" cutoff the product page uses
HISTORY_FOR_AGENT = 20  # saved messages the agent re-reads each turn (10 back-and-forths)
HISTORY_FOR_PANEL = 50  # saved messages shown when a logged-in shopper reopens the chat


class MissingAPIKeyError(RuntimeError):
    pass


def model_name() -> str:
    return os.getenv("OPENAI_MODEL", DEFAULT_MODEL)


def make_model() -> OpenAIChatModel:
    """The chat model, routed through Portkey. The name defaults to OPENAI_MODEL."""
    api_key = os.getenv("PORTKEY_API_KEY")
    if not api_key:
        raise MissingAPIKeyError("Missing PORTKEY_API_KEY. Set it, or copy .env.example to .env and add it there.")
    client = AsyncOpenAI(base_url=PORTKEY_BASE_URL, api_key=api_key)
    return OpenAIChatModel(model_name(), provider=OpenAIProvider(openai_client=client))


def system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


# --- Database ---------------------------------------------------------------------------


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Open the shop database; commits on success, rolls back on error, always closes."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def ensure_schema() -> None:
    """Add what accounts and chat memory need to the shop database. Safe to run every start."""
    with get_db() as con:
        con.execute(
            """CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )"""
        )
        columns = {r["name"] for r in con.execute("PRAGMA table_info(chat_messages)")}
        if "results_title" not in columns:
            # Remembers that a reply put search results on the page, so reloading the chat
            # can offer them again.
            con.execute("ALTER TABLE chat_messages ADD COLUMN results_title TEXT")
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (user_id, id)"
        )
        con.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")

        # Wishlist, cart, and saved embroidery designs (shop.py).
        con.execute(
            """CREATE TABLE IF NOT EXISTS wishlist_items (
                user_id INTEGER NOT NULL,
                product_id TEXT NOT NULL,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, product_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (product_id) REFERENCES catalogue(product_id)
            )"""
        )
        con.execute(
            """CREATE TABLE IF NOT EXISTS cart_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                embroidery_text TEXT,
                embroidery_location TEXT,
                embroidery_thread TEXT,
                added_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (product_id) REFERENCES catalogue(product_id)
            )"""
        )
        # Cart lines saved before color and thread color were required: fill in the garment's
        # only color, and white thread for embroidered lines.
        cart_columns = {r["name"] for r in con.execute("PRAGMA table_info(cart_items)")}
        for column in ("color", "embroidery_thread"):
            if column not in cart_columns:
                con.execute(f"ALTER TABLE cart_items ADD COLUMN {column} TEXT")
        con.execute(
            "UPDATE cart_items SET color = (SELECT json_extract(colors, '$[0]') FROM catalogue "
            "WHERE catalogue.product_id = cart_items.product_id) WHERE color IS NULL"
        )
        con.execute(
            "UPDATE cart_items SET embroidery_thread = 'White' "
            "WHERE embroidery_text IS NOT NULL AND embroidery_thread IS NULL"
        )

        # A saved design is its text, spot, and thread color. Older tables (unique on text and
        # spot only) are rebuilt with the thread color, keeping their designs (as white thread).
        design_columns = {r["name"] for r in con.execute("PRAGMA table_info(embroidery_designs)")}
        if design_columns and "thread_color" not in design_columns:
            con.execute("ALTER TABLE embroidery_designs RENAME TO embroidery_designs_old")
        con.execute(
            """CREATE TABLE IF NOT EXISTS embroidery_designs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                location TEXT NOT NULL,
                thread_color TEXT NOT NULL DEFAULT 'White',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (user_id, text, location, thread_color),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )"""
        )
        if design_columns and "thread_color" not in design_columns:
            con.execute(
                "INSERT INTO embroidery_designs (id, user_id, text, location, thread_color, created_at) "
                "SELECT id, user_id, text, location, 'White', created_at FROM embroidery_designs_old"
            )
            con.execute("DROP TABLE embroidery_designs_old")

        # Shared wishlist links (shop.create_wishlist_share): a snapshot of the list, with
        # only what its owner chose to share (no account id or email).
        con.execute(
            """CREATE TABLE IF NOT EXISTS shared_wishlists (
                token TEXT PRIMARY KEY,
                owner_name TEXT,
                note TEXT,
                items_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )


def image_url(image_file_path: str) -> str:
    # The database stores paths like "products/basic-hoodie-big-yale.jpg" (relative to data/).
    return f"/images/{image_file_path}"


def short_description(text: str, limit: int = SHORT_DESCRIPTION_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def size_sort_key(size: str) -> int:
    return SIZE_ORDER.index(size) if size in SIZE_ORDER else len(SIZE_ORDER)


SIZE_ALIASES = {
    "xs": "XS", "xsmall": "XS", "extrasmall": "XS",
    "s": "S", "sm": "S", "small": "S",
    "m": "M", "med": "M", "medium": "M",
    "l": "L", "lg": "L", "large": "L",
    "xl": "XL", "xlarge": "XL", "extralarge": "XL",
    "xxl": "XXL", "2xl": "XXL", "2x": "XXL", "xxlarge": "XXL", "2xlarge": "XXL",
}


def normalize_size(size: str) -> str:
    """Turn what a shopper types ("medium", "x-large", "2XL") into a standard size code.
    Sizes we don't recognize come back uppercased, e.g. "XXXL"."""
    key = re.sub(r"[\s\-_.]", "", size.lower())
    return SIZE_ALIASES.get(key, size.strip().upper())


def product_cards(product_ids: list[str], limit: int) -> list[ProductCard]:
    """Turn the agent's chosen product_ids into cards, using only what's in the database.

    Unknown ids are dropped, so the model can't put a made-up product (or price) on screen.
    """
    wanted = list(dict.fromkeys(pid.strip().lower() for pid in product_ids))
    if not wanted:
        return []
    with get_db() as con:
        rows = con.execute(
            f"SELECT product_id, name, price, description, image_file_path FROM catalogue "
            f"WHERE product_id IN ({','.join('?' * len(wanted))})",
            wanted,
        ).fetchall()
    found = {r["product_id"]: r for r in rows}
    return [
        ProductCard(
            product_id=pid,
            name=found[pid]["name"],
            price=found[pid]["price"],
            short_description=short_description(found[pid]["description"]),
            image_url=image_url(found[pid]["image_file_path"]),
        )
        for pid in wanted
        if pid in found
    ][:limit]


# --- Agent tools ------------------------------------------------------------------------

STOPWORDS = {
    "a", "an", "and", "any", "are", "do", "does", "for", "have", "i", "in", "is", "it", "me",
    "my", "of", "or", "show", "some", "something", "that", "the", "there", "this", "to",
    "want", "what", "with", "you", "your", "yale", "campus", "customs",
}
# Where a word is found counts for more in some fields than others.
FIELD_WEIGHTS = {"name": 3, "garment_type": 2, "search_tags": 2, "colors": 2, "description": 1}
CATEGORY_WEIGHT = 3  # matching the kind of garment counts like a word in the name

# The kind of garment a shopper means, in the words they actually use. Checked in order, and
# each match is taken out of the query, so "hooded sweatshirt" means hoodie, not any sweatshirt.
GARMENT_WORDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(?:t[- ]?shirts?|tee[- ]?shirts?|tees?)\b"), "t-shirt"),
    (re.compile(r"\b(?:hood(?:ie|y)s?|hoodies|hooded(?: sweat ?shirts?| pullovers?)?|hoods?)\b"), "hoodie"),
    (re.compile(r"\bcrew[- ]?necks?\b"), "crewneck"),
    (re.compile(r"\b(?:quarter[- ]?zips?|1/4[- ]?zips?|1 4 zips?)\b"), "quarter-zip"),
    (re.compile(r"\b(?:jackets?|coats?|bombers?)\b"), "jacket"),
    (re.compile(r"\bfleeces?\b"), "fleece"),
    (re.compile(r"\b(?:long[- ]sleeves?|performance shirts?)\b"), "long-sleeve"),
    (re.compile(r"\b(?:sweat ?shirts?|pullovers?)\b"), "sweatshirt"),
]
# Other spellings and family words, mapped to the words the catalogue uses.
WORD_VARIANTS = {
    "grey": "gray", "colour": "color", "mother": "mom", "father": "dad",
    "grandmother": "grandma", "grandfather": "grandpa",
}


def garment_categories(garment_type: str, name: str) -> set[str]:
    """The kinds of garment a catalogue row is, from its (inconsistently written) garment_type."""
    t, n = garment_type.lower(), name.lower()
    kinds = set()
    if "t-shirt" in t:
        kinds.add("t-shirt")
    if "hood" in t:
        kinds.add("hoodie")
    if "crew" in t and "t-shirt" not in t:
        kinds.add("crewneck")
    if "quarter-zip" in t:
        kinds.add("quarter-zip")
    if "jacket" in t:
        kinds.add("jacket")
    if "fleece" in t or "fleece" in n:
        kinds.add("fleece")
    if "long-sleeve" in t:
        kinds.add("long-sleeve")
    if "sweatshirt" in t or "mockneck" in t or kinds & {"hoodie", "crewneck", "quarter-zip"}:
        kinds.add("sweatshirt")
    return kinds


def _parse_query(query: str) -> tuple[set[str], list[str]]:
    """Split a query into the garment kinds it names and the other words to look for."""
    text = query.lower()
    kinds = set()
    for pattern, kind in GARMENT_WORDS:
        if pattern.search(text):
            kinds.add(kind)
            text = pattern.sub(" ", text)
    terms = []
    for word in re.findall(r"[a-z0-9]+", text):
        word = WORD_VARIANTS.get(word, word)
        if len(word) < 2 or word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]  # "colleges" -> "college", "bulldogs" -> "bulldog"
        terms.append(word)
    return kinds, list(dict.fromkeys(terms))


def search_products(query: str, limit: int = DEFAULT_SEARCH_RESULTS) -> list[ProductMatch]:
    """Search the Campus Customs catalogue.

    Use this first to find products and their product_id. It understands garment words the
    way shoppers say them ("tee", "hoody", "1/4 zip", "crewneck") and matches the other
    words against each product's name, colors, search tags, and description.
    Results have no price or stock: use get_price and check_stock for those.

    Args:
        query: What the shopper is looking for, in a few keywords, e.g. "navy hoodie",
            "Pierson crewneck", "hockey", "quarter zip", "grey tees".
        limit: Most results to return (1-30). Use 30 when the shopper is browsing a type
            of item, so every match can be shown on the page.

    Returns:
        Matching products, best match first. An empty list means nothing matched; try
        fewer or broader keywords before telling the shopper we don't carry it.
    """
    kinds, terms = _parse_query(query)
    if not kinds and not terms:
        return []
    limit = max(1, min(limit, MAX_SEARCH_RESULTS))

    with get_db() as con:
        rows = con.execute(
            "SELECT product_id, name, garment_type, colors, search_tags, description FROM catalogue"
        ).fetchall()

    scored = []
    for row in rows:
        fields = {field: str(row[field]).lower() for field in FIELD_WEIGHTS}
        score, matched = 0, 0
        # The kind of garment counts as one thing to match, like a word.
        if kinds & garment_categories(row["garment_type"], row["name"]):
            matched += 1
            score += CATEGORY_WEIGHT
        for term in terms:
            # Match at the start of a word, so "hood" finds "hoodie" but "art" doesn't find "quarter".
            pattern = re.compile(rf"\b{re.escape(term)}")
            hits = [w for field, w in FIELD_WEIGHTS.items() if pattern.search(fields[field])]
            if hits:
                matched += 1
                score += max(hits)
        if matched:
            scored.append((matched, score, row))

    # Most things matched first, then the strongest matches, then by name so ties are stable.
    scored.sort(key=lambda item: (-item[0], -item[1], item[2]["name"]))
    return [
        ProductMatch(
            product_id=row["product_id"],
            name=row["name"],
            garment_type=row["garment_type"],
            colors=json.loads(row["colors"]),
            short_description=short_description(row["description"]),
        )
        for _, _, row in scored[:limit]
    ]


def _catalogue_row(con: sqlite3.Connection, product_id: str) -> sqlite3.Row:
    row = con.execute(
        "SELECT * FROM catalogue WHERE product_id = ?", (product_id.strip().lower(),)
    ).fetchone()
    if row is None:
        # Sent back to the model so it can correct itself instead of guessing.
        raise ModelRetry(
            f"No product has product_id {product_id!r}. Call search_products to find the "
            "right product_id, and copy it exactly."
        )
    return row


def get_product_description(product_id: str) -> ProductDescription:
    """Get the full catalogue description of one product.

    Use this when the shopper asks what a product looks like, what it's made like, or for
    more detail than the search result gives.

    Args:
        product_id: The product's product_id, copied exactly from search_products.
    """
    with get_db() as con:
        row = _catalogue_row(con, product_id)
    return ProductDescription(
        product_id=row["product_id"],
        name=row["name"],
        garment_type=row["garment_type"],
        description=row["description"],
        colors=json.loads(row["colors"]),
    )


def get_price(product_id: str) -> ProductPrice:
    """Get the current price of one product from the shop database.

    Always call this before stating any price. Never guess or round a price.

    Args:
        product_id: The product's product_id, copied exactly from search_products.
    """
    with get_db() as con:
        row = _catalogue_row(con, product_id)
    return ProductPrice(product_id=row["product_id"], name=row["name"], price=row["price"])


def _size_status(quantity: int) -> StockStatus:
    if quantity == 0:
        return "sold_out"
    return "low_stock" if quantity <= LOW_STOCK else "in_stock"


def check_stock(product_id: str, size: str | None = None) -> StockReport:
    """Check how many units of one product are in stock, by size.

    Always call this before saying whether something is in stock or how many are left.
    Pass `size` when the shopper asks about a specific size; the report then says whether
    that size is in_stock, low_stock, sold_out, or not_offered.

    Args:
        product_id: The product's product_id, copied exactly from search_products.
        size: Optional size the shopper asked about, e.g. "M", "medium", "XL", "2XL".
    """
    with get_db() as con:
        row = _catalogue_row(con, product_id)
        stock = con.execute(
            "SELECT size, quantity FROM inventory WHERE product_id = ?", (row["product_id"],)
        ).fetchall()

    sizes = sorted(
        (SizeStock(size=s["size"], quantity=s["quantity"]) for s in stock),
        key=lambda s: size_sort_key(s.size),
    )
    by_size = {s.size: s.quantity for s in sizes}

    requested = normalize_size(size) if size and size.strip() else None
    if requested is None:
        status, quantity = None, None
    elif requested in by_size:
        quantity = by_size[requested]
        status = _size_status(quantity)
    else:
        status, quantity = "not_offered", None

    return StockReport(
        product_id=row["product_id"],
        name=row["name"],
        requested_size=requested,
        requested_size_status=status,
        requested_size_quantity=quantity,
        sizes=sizes,
        available_sizes=[s.size for s in sizes if s.quantity > 0],
        sold_out_sizes=[s.size for s in sizes if s.quantity == 0],
        total_in_stock=sum(s.quantity for s in sizes),
    )


# --- Who is chatting and where (the agent's deps) ---------------------------------------


def customer_info(user: sqlite3.Row) -> CustomerInfo:
    first, _, last = user["name"].partition(" ")
    return CustomerInfo(
        first_name=user["first_name"] or first,
        last_name=user["last_name"] or last,
        email=user["email"],
    )


PAGE_PATTERNS: list[tuple[re.Pattern[str], PageType]] = [
    (re.compile(r"^/$"), "home"),
    (re.compile(r"^/products/?$"), "products"),
    (re.compile(r"^/products/[^/]+/?$"), "product"),
    (re.compile(r"^/about/?$"), "about"),
    (re.compile(r"^/login/?$"), "login"),
    (re.compile(r"^/create-account/?$"), "create_account"),
]


def resolve_page(page: PageContext) -> PageInfo:
    """Turn the page the browser reports into checked facts for the agent.

    Only a page type from a fixed list and a product read from the database reach the agent,
    never raw text from the browser, so a crafted URL can't slip instructions into the prompt.
    """
    page_type: PageType = next((t for p, t in PAGE_PATTERNS if p.match(page.path)), "other")
    product = None
    if page_type == "product" and page.product_id:
        with get_db() as con:
            row = con.execute(
                "SELECT * FROM catalogue WHERE product_id = ?", (page.product_id.strip().lower(),)
            ).fetchone()
        if row:
            product = ProductDescription(
                product_id=row["product_id"],
                name=row["name"],
                garment_type=row["garment_type"],
                description=row["description"],
                colors=json.loads(row["colors"]),
            )
    return PageInfo(page_type=page_type, product=product)


# --- Chat history (logged-in shoppers only) ---------------------------------------------


def load_chat_history(user_id: int, limit: int) -> list[sqlite3.Row]:
    """The shopper's most recent saved messages, oldest first."""
    with get_db() as con:
        rows = con.execute(
            "SELECT role, content, products_json, results_title, created_at FROM chat_messages "
            "WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return rows[::-1]


def _saved_product_ids(products_json: str | None) -> list[str]:
    # Saved replies list their products as JSON objects with a product_id (the seed rows
    # carry extra fields too). Cards are rebuilt from the catalogue, so prices stay current.
    try:
        items = json.loads(products_json or "[]")
    except json.JSONDecodeError:
        return []
    return [p["product_id"] for p in items if isinstance(p, dict) and p.get("product_id")]


def saved_chat_messages(user_id: int) -> list[ChatHistoryMessage]:
    """The saved conversation, ready for the chat panel to show again."""
    messages = []
    for row in load_chat_history(user_id, HISTORY_FOR_PANEL):
        limit = MAX_PAGE_RESULTS if row["results_title"] else MAX_CHAT_CARDS
        messages.append(
            ChatHistoryMessage(
                role=row["role"],
                content=row["content"],
                products=product_cards(_saved_product_ids(row["products_json"]), limit),
                results_title=row["results_title"],
                created_at=row["created_at"],
            )
        )
    return messages


def save_chat_turn(user_id: int, message: str, reply: ChatReply) -> None:
    """Save the shopper's message and the agent's reply as two chat_messages rows."""
    products_json = json.dumps([p.model_dump() for p in reply.products])
    with get_db() as con:
        con.execute(
            "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)",
            (user_id, message),
        )
        con.execute(
            "INSERT INTO chat_messages (user_id, role, content, products_json, results_title) "
            "VALUES (?, 'assistant', ?, ?, ?)",
            (user_id, reply.reply, products_json, reply.results_title),
        )
