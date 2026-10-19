"""Settings, database access, and the tools the Campus Customs chat agent can call.

Tools (registered on the agent in agent.py). All six live in this file, and every one reads
data/campus_customs.db.
    search_products           find catalogue items that match what the shopper is asking for
    get_product_description   full catalogue text for one product
    get_price                 current price for one product
    check_stock               units in stock for one product, by size (and one size if asked)
    recommend_size            which size to get, from the size guide's chart, and its stock
    similar_in_stock          similar items that are in stock in a sold-out size

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

from merch_groups import group_label, product_groups
from models import (
    MAX_CHAT_CARDS,
    MAX_PAGE_RESULTS,
    ChatHistoryMessage,
    ChatReply,
    CustomerInfo,
    FitPreference,
    InStockAlternative,
    PageContext,
    PageInfo,
    PageType,
    ProductCard,
    ProductDescription,
    ProductMatch,
    ProductPrice,
    SizeAdvice,
    SizeChart,
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


# --- Size advice: the recommend_size tool (the chat's fit finder) ---------------------------
# The chart is the same one the Home page size guide shows
# (frontend/src/components/SizeGuide.tsx); evals/shopping_eval.py checks the two still match.
# Our garments are a unisex cut, so sizes are given on the unisex chart:
#     chest measurement   -> the unisex size whose chest range fits it
#     usual unisex size   -> that size
#     usual women's size  -> the unisex size for the middle of that women's bust range
#                            (a women's M, bust 35-36", is a unisex S)
# then adjusted for how the shopper likes things to fit, and checked against stock.

SIZES = SIZE_ORDER  # the size chart's columns, XS..XXL

# Body measurements in inches, [min, max] for XS..XXL (SizeGuide.tsx MEASUREMENTS.*.chest).
CHEST: dict[str, list[tuple[float, float]]] = {
    "unisex": [(32, 34), (35, 37), (38, 40), (41, 43), (44, 46), (47, 49)],
    "womens": [(31, 32), (33, 34), (35, 36), (37, 39), (40, 42), (43, 45)],
}

# How each kind of garment fits (SizeGuide.tsx PRODUCTS.*.fit).
FIT_NOTES = {
    "tee": "Classic fit. Cotton tees can shrink a little in a hot dryer, so wash cold if you are between sizes.",
    "sweatshirt": (
        "Relaxed fit for crewnecks, hoodies, and quarter-zips. Between sizes? Size down for a "
        "closer fit, or up for that oversized library look."
    ),
    "jacket": "Cut with room to layer over a sweater. Between sizes? Take your usual size.",
}


def chart_kind(garment_type: str, name: str) -> str:
    """Which size chart a product uses: tee, sweatshirt, or jacket (as productKind() in categories.ts)."""
    kinds = garment_categories(garment_type, name)
    if kinds & {"t-shirt", "long-sleeve"}:
        return "tee"
    if kinds & {"jacket", "fleece"}:
        return "jacket"
    return "sweatshirt"


def size_for_chest(chest: float, chart: str = "unisex") -> str:
    """The smallest size whose chest range reaches this measurement (between sizes: the larger)."""
    for size, (_, high) in zip(SIZES, CHEST[chart]):
        if chest <= high:
            return size
    return SIZES[-1]


def _step(size: str, by: int) -> str:
    i = SIZES.index(size) + by
    return SIZES[max(0, min(i, len(SIZES) - 1))]


def recommend_size(
    product_id: str,
    usual_size: str | None = None,
    size_chart: SizeChart = "unisex",
    fit: FitPreference = "regular",
    chest_inches: float | None = None,
) -> SizeAdvice:
    """Recommend a size for one product, and check that size's stock.

    Use this when a shopper asks what size to get or whether something will fit. You need
    either their usual size or their chest/bust measurement first; ask for it if you don't
    have it (and whether that's a women's or unisex/men's size, and how they like it to fit).

    Args:
        product_id: The product's product_id, copied exactly from search_products.
        usual_size: The size the shopper usually wears, e.g. "M", "large", "XL".
        size_chart: "womens" if their usual size is a women's size; otherwise "unisex"
            (men's sizes are unisex sizes).
        fit: How they like it to fit: "regular", "fitted" (closer), or "roomy" (oversized).
        chest_inches: Their chest or bust measurement in inches, if they gave one. Used
            instead of usual_size when both are given.
    """
    with get_db() as con:
        row = _catalogue_row(con, product_id)
        stock = {
            r["size"]: r["quantity"]
            for r in con.execute("SELECT size, quantity FROM inventory WHERE product_id = ?", (row["product_id"],))
        }
    kind = chart_kind(row["garment_type"], row["name"])

    if chest_inches is not None:
        if not 20 <= chest_inches <= 70:
            raise ModelRetry("chest_inches should be the shopper's chest or bust in inches, between 20 and 70.")
        size = size_for_chest(chest_inches)
        reason = f'A {chest_inches:g}" {"bust" if size_chart == "womens" else "chest"} is an {size} on our unisex chart'
    elif usual_size:
        usual = normalize_size(usual_size)
        if usual not in SIZES:
            raise ModelRetry(f"usual_size should be one of {', '.join(SIZES)}; the shopper said {usual_size!r}.")
        if size_chart == "womens":
            low, high = CHEST["womens"][SIZES.index(usual)]
            size = size_for_chest((low + high) / 2)
            reason = f"Our garments are a unisex cut, and a women's {usual} is about a unisex {size}"
        else:
            size = usual
            reason = f"You usually wear an {usual}"
    else:
        raise ModelRetry(
            "Ask the shopper for their usual size (and whether it's a women's or unisex/men's size) "
            "or their chest measurement before calling recommend_size."
        )

    if fit == "roomy":
        size = _step(size, +1)
        reason += f"; one size up, {size}, gives the roomier fit you like"
    elif fit == "fitted" and kind == "sweatshirt":
        size = _step(size, -1)
        reason += f"; these run relaxed, so {size} fits closer"
    elif fit == "fitted":
        reason += "; tees are a classic fit, so that size already fits close" if kind == "tee" else (
            "; jackets are cut to layer, so keep your usual size"
        )

    # Only sizes this product is made in.
    offered = sorted(stock, key=size_sort_key)
    if size not in stock and offered:
        size = min(offered, key=lambda s: abs(SIZES.index(s) - SIZES.index(size)) if s in SIZES else 99)
        reason += f"; the nearest size we make in this item is {size}"

    quantity = stock.get(size, 0)
    return SizeAdvice(
        product_id=row["product_id"],
        name=row["name"],
        recommended_size=size,
        reason=reason + ".",
        fit_note=FIT_NOTES[kind],
        recommended_size_status=_size_status(quantity),
        recommended_size_quantity=quantity,
        available_sizes=[s for s in offered if stock[s] > 0],
    )


# --- Similar items in stock: the similar_in_stock tool ------------------------------------
# Used when a shopper's size has sold out: by the agent, on the product page
# (GET /api/products/{id}/alternatives?size=L), and on shared wishlists. "Similar" means, in
# order of weight: the same merchandise group (another Pierson College item), the same kind
# of garment (another crewneck), and words in common in the name ("Champion Reverse Weave").
# Only products with at least one unit in the requested size are returned.

GROUP_WEIGHT = 3
KIND_WEIGHT = 2
WORD_WEIGHT = 1
MAIN_KINDS = ["hoodie", "quarter-zip", "crewneck", "t-shirt", "jacket", "long-sleeve"]
KIND_LABELS = {
    "hoodie": "hoodie", "quarter-zip": "quarter-zip", "crewneck": "crewneck",
    "t-shirt": "T-shirt", "jacket": "jacket", "long-sleeve": "long-sleeve shirt",
}
# Words every product shares, which say nothing about similarity.
COMMON_WORDS = {
    "yale", "t", "shirt", "tee", "crewneck", "hoodie", "zip", "1", "4", "jacket", "fleece",
    "sweater", "college", "school", "of", "the", "left", "chest", "and", "vs",
}


def main_kind(row: sqlite3.Row) -> str | None:
    kinds = garment_categories(row["garment_type"], row["name"])
    return next((k for k in MAIN_KINDS if k in kinds), None)


def _name_words(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in COMMON_WORDS}


def similar_in_size(
    con: sqlite3.Connection, product_id: str, size: str | None, limit: int = 4
) -> list[tuple[sqlite3.Row, str]]:
    """Up to `limit` (product row, why) pairs, most similar first. With no size, any
    product with stock counts."""
    product = con.execute("SELECT * FROM catalogue WHERE product_id = ?", (product_id,)).fetchone()
    if product is None:
        return []
    groups = set(product_groups(product["name"], product["description"]))
    kind = main_kind(product)
    words = _name_words(product["name"])

    if size:
        rows = con.execute(
            "SELECT c.* FROM catalogue c JOIN inventory i ON i.product_id = c.product_id "
            "WHERE i.size = ? AND i.quantity > 0 AND c.product_id != ?",
            (size, product_id),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT c.* FROM catalogue c WHERE c.product_id != ? AND EXISTS "
            "(SELECT 1 FROM inventory i WHERE i.product_id = c.product_id AND i.quantity > 0)",
            (product_id,),
        ).fetchall()

    scored = []
    for row in rows:
        shared = sorted(groups & set(product_groups(row["name"], row["description"])))
        same_kind = kind is not None and main_kind(row) == kind
        common = words & _name_words(row["name"])
        score = GROUP_WEIGHT * len(shared) + KIND_WEIGHT * same_kind + WORD_WEIGHT * len(common)
        if score == 0:
            continue
        if shared:
            why = f"Also {group_label(shared[0])}"
        elif same_kind:
            why = f"Another {KIND_LABELS[kind]}"
        else:
            why = "A similar style"
        scored.append((score, row["name"], row, why))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [(row, why) for _, _, row, why in scored[:limit]]


def similar_in_stock(product_id: str, size: str) -> list[InStockAlternative]:
    """Find similar products that are in stock in the shopper's size.

    Use this when the size a shopper wants is sold out (check_stock or recommend_size says
    sold_out), so they still have something to buy. Results favor the same college, team,
    school, or family group, then the same kind of garment. They have no price or stock
    count: call get_price or check_stock before quoting either.

    Args:
        product_id: The sold-out product's product_id, copied exactly from a tool result.
        size: The size the shopper wants, e.g. "M", "large", "XL".
    """
    wanted = normalize_size(size)
    with get_db() as con:
        row = _catalogue_row(con, product_id)
        found = similar_in_size(con, row["product_id"], wanted, limit=4)
    return [
        InStockAlternative(product_id=r["product_id"], name=r["name"], garment_type=r["garment_type"], why=why)
        for r, why in found
    ]


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
