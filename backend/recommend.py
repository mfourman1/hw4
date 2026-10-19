"""Similar products that are in stock in a given size.

Used when a shopper's size has sold out: on the product page (GET
/api/products/{id}/alternatives?size=L), on shared wishlists, and by the chat agent's
similar_in_stock tool. "Similar" means, in order of weight:

    the same merchandise group   (another Pierson College item, more Yale Ice Hockey gear)
    the same kind of garment     (another crewneck)
    words in common in the name  (both "Champion Reverse Weave")

Only products with at least one unit in the requested size are returned.
"""

from __future__ import annotations

import re
import sqlite3

from merch_groups import group_label, product_groups
from models import InStockAlternative
from tools import _catalogue_row, garment_categories, get_db, normalize_size

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
