"""Wishlist, shopping cart, and saved embroidery designs for logged-in shoppers.

Guests keep the same three lists in their browser; when they log in, main.py calls
merge_guest_state() to move them into their account. There is no checkout or payment:
the cart is a list to bring to the shop (a project decision, see output/harness.md).

Tables (created by tools.ensure_schema): wishlist_items, cart_items, embroidery_designs.
Every function here takes the user_id from the session, never from the browser.
"""

from __future__ import annotations

import re
import json
import secrets
import sqlite3
from typing import get_args

from models import (
    MAX_LINE_QUANTITY,
    CartAdd,
    CartLine,
    Embroidery,
    EmbroideryDesign,
    EmbroideryLocation,
    EmbroideryOption,
    GroupOrder,
    SharedItem,
    SharedWishlist,
    ShopMerge,
    ShopState,
    ThreadColor,
    WishlistShareCreate,
)
from privacy import redact
from tools import get_db, normalize_size

EMBROIDERY_PRICE = 10.00  # per embroidered item (decided by the shop owner)
MAX_SAVED_DESIGNS = 20
THREAD_COLORS: list[str] = list(get_args(ThreadColor))
DEFAULT_THREAD = "White"  # only for designs/cart lines saved before thread color existed

LEFT_CHEST = re.compile(r"left[- ]chest", re.I)


class ShopError(ValueError):
    """A request the shop can't do (unknown product, bad size, not enough stock…)."""


# --- Embroidery rules -------------------------------------------------------------------


def embroidery_options(product: sqlite3.Row) -> list[EmbroideryOption]:
    """Where a product can be embroidered.

    Only garments without a large central design qualify. In this catalogue those are the
    ones whose only front design is a small logo on the left chest, so left-chest
    embroidery goes just below that logo. Products with large central text get none.
    """
    if not LEFT_CHEST.search(product["description"]):
        return []
    return [
        EmbroideryOption(location="left_chest", label="Left chest, below the logo"),
        EmbroideryOption(location="right_chest", label="Right chest"),
        EmbroideryOption(location="shoulder", label="Shoulder"),
    ]


def _allowed_locations(product: sqlite3.Row) -> set[EmbroideryLocation]:
    return {o.location for o in embroidery_options(product)}


def colorway(product: sqlite3.Row) -> str:
    """The garment's main color: the first entry in `colors`. The rest of that list are the
    colors of its trim and design, not other options."""
    colors = json.loads(product["colors"] or "[]")
    return colors[0] if colors else "as pictured"


def color_options(product: sqlite3.Row) -> list[str]:
    """The colors a shopper can choose for this product.

    Every product in the catalogue today comes in one color, so this is a single option
    (the site selects it automatically). If the shop starts carrying an item in several
    colors, list them here: the product page will then ask the shopper to pick one, and the
    cart will accept any of them. Stock is tracked by size only, so such an item would also
    need its inventory split by color.
    """
    return [colorway(product)]


# --- Reading the state ------------------------------------------------------------------


def get_shop_state(user_id: int) -> ShopState:
    with get_db() as con:
        wishlist = [
            r["product_id"]
            for r in con.execute(
                "SELECT product_id FROM wishlist_items WHERE user_id = ? ORDER BY added_at DESC, rowid DESC",
                (user_id,),
            )
        ]
        cart = [
            CartLine(
                id=str(r["id"]),
                product_id=r["product_id"],
                size=r["size"],
                color=r["color"],
                quantity=r["quantity"],
                embroidery=(
                    Embroidery(
                        text=r["embroidery_text"],
                        location=r["embroidery_location"],
                        thread_color=r["embroidery_thread"],
                    )
                    if r["embroidery_text"]
                    else None
                ),
            )
            for r in con.execute("SELECT * FROM cart_items WHERE user_id = ? ORDER BY id", (user_id,))
        ]
        designs = [
            EmbroideryDesign(
                id=str(r["id"]), text=r["text"], location=r["location"], thread_color=r["thread_color"]
            )
            for r in con.execute(
                "SELECT * FROM embroidery_designs WHERE user_id = ? ORDER BY id DESC", (user_id,)
            )
        ]
    return ShopState(wishlist=wishlist, cart=cart, designs=designs)


def _product(con: sqlite3.Connection, product_id: str) -> sqlite3.Row:
    row = con.execute(
        "SELECT * FROM catalogue WHERE product_id = ?", (product_id.strip().lower(),)
    ).fetchone()
    if row is None:
        raise ShopError("That product doesn't exist.")
    return row


# --- Wishlist ---------------------------------------------------------------------------


def add_to_wishlist(user_id: int, product_id: str) -> None:
    with get_db() as con:
        product = _product(con, product_id)
        con.execute(
            "INSERT OR IGNORE INTO wishlist_items (user_id, product_id) VALUES (?, ?)",
            (user_id, product["product_id"]),
        )


def remove_from_wishlist(user_id: int, product_id: str) -> None:
    with get_db() as con:
        con.execute(
            "DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?", (user_id, product_id)
        )


# --- Embroidery designs -----------------------------------------------------------------


def _save_design(con: sqlite3.Connection, user_id: int, design: Embroidery) -> None:
    con.execute(
        "INSERT OR IGNORE INTO embroidery_designs (user_id, text, location, thread_color) "
        "VALUES (?, ?, ?, ?)",
        (user_id, design.text, design.location, design.thread_color or DEFAULT_THREAD),
    )
    # Keep only the most recent designs.
    con.execute(
        "DELETE FROM embroidery_designs WHERE user_id = ? AND id NOT IN "
        "(SELECT id FROM embroidery_designs WHERE user_id = ? ORDER BY id DESC LIMIT ?)",
        (user_id, user_id, MAX_SAVED_DESIGNS),
    )


def save_design(user_id: int, design: Embroidery) -> None:
    with get_db() as con:
        _save_design(con, user_id, design)


def delete_design(user_id: int, design_id: int) -> None:
    with get_db() as con:
        con.execute("DELETE FROM embroidery_designs WHERE user_id = ? AND id = ?", (user_id, design_id))


# --- Cart -------------------------------------------------------------------------------


def _check_stock(con: sqlite3.Connection, user_id: int, product_id: str, size: str,
                 wanted: int, ignore_line: int | None = None) -> None:
    """Make sure the cart never holds more of a product+size than the shop has."""
    stock = con.execute(
        "SELECT quantity FROM inventory WHERE product_id = ? AND size = ?", (product_id, size)
    ).fetchone()
    if stock is None:
        raise ShopError(f"Size {size} isn't offered for this product.")
    in_cart = con.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM cart_items "
        "WHERE user_id = ? AND product_id = ? AND size = ? AND id != ?",
        (user_id, product_id, size, ignore_line or -1),
    ).fetchone()[0]
    if in_cart + wanted > stock["quantity"]:
        left = max(stock["quantity"] - in_cart, 0)
        if stock["quantity"] == 0:
            raise ShopError(f"Size {size} is sold out.")
        if in_cart == 0:
            raise ShopError(f"We only have {left} in size {size}.")
        raise ShopError(
            f"We only have {stock['quantity']} in size {size}, and {in_cart} are already in your cart."
        )


def _add_to_cart(con: sqlite3.Connection, user_id: int, item: CartAdd, from_guest: bool = False) -> None:
    """Add one line. The shopper must have confirmed the color and, for embroidery, picked a
    thread color. Items a guest collected before these were required (from_guest) get the
    garment's only color and the default thread instead of being dropped."""
    product = _product(con, item.product_id)
    product_id, size = product["product_id"], item.size.strip().upper()
    options = color_options(product)
    if item.color is None:
        if not from_guest and len(options) > 1:
            raise ShopError("Choose a color.")
        color = options[0]  # one color (or an older guest line): use it
    else:
        color = next((o for o in options if o.lower() == item.color.strip().lower()), None)
        if color is None:
            raise ShopError(
                f"This item only comes in {options[0]}."
                if len(options) == 1
                else f"Choose one of these colors: {', '.join(options)}."
            )
    embroidery = item.embroidery
    if embroidery:
        if embroidery.location not in _allowed_locations(product):
            raise ShopError("Embroidery isn't offered in that spot on this product.")
        if embroidery.thread_color is None:
            if not from_guest:
                raise ShopError("Choose a thread color for the embroidery.")
            embroidery = embroidery.model_copy(update={"thread_color": DEFAULT_THREAD})
    _check_stock(con, user_id, product_id, size, item.quantity)

    text = embroidery.text if embroidery else None
    location = embroidery.location if embroidery else None
    thread = embroidery.thread_color if embroidery else None
    # The same garment, size, color, and embroidery goes on one line with a bigger quantity.
    same = con.execute(
        "SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ? AND size = ? "
        "AND color IS ? AND embroidery_text IS ? AND embroidery_location IS ? AND embroidery_thread IS ?",
        (user_id, product_id, size, color, text, location, thread),
    ).fetchone()
    if same:
        if same["quantity"] + item.quantity > MAX_LINE_QUANTITY:
            raise ShopError(f"You can have at most {MAX_LINE_QUANTITY} of one item in your cart.")
        con.execute("UPDATE cart_items SET quantity = quantity + ? WHERE id = ?", (item.quantity, same["id"]))
    else:
        con.execute(
            "INSERT INTO cart_items (user_id, product_id, size, color, quantity, "
            "embroidery_text, embroidery_location, embroidery_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, product_id, size, color, item.quantity, text, location, thread),
        )
    if embroidery and item.save_design:
        _save_design(con, user_id, embroidery)


def add_to_cart(user_id: int, item: CartAdd) -> None:
    with get_db() as con:
        _add_to_cart(con, user_id, item)


def add_group_order(user_id: int, order: GroupOrder) -> int:
    """Add a group order: one cart line per size, with the same color and embroidery.

    All or nothing: the lines are added in one transaction, so if any size is short on
    stock, the error names it and nothing is added. Returns the number of pieces added.
    """
    wanted = [s for s in order.sizes if s.quantity > 0]
    if not wanted:
        raise ShopError("Enter how many you need in at least one size.")
    sizes = [s.size.strip().upper() for s in wanted]
    if len(set(sizes)) != len(sizes):
        raise ShopError("Each size can only be listed once.")
    with get_db() as con:
        for line in wanted:
            item = CartAdd(
                product_id=order.product_id,
                size=line.size,
                color=order.color,
                quantity=line.quantity,
                embroidery=order.embroidery,
                save_design=order.save_design,
            )
            try:
                _add_to_cart(con, user_id, item)
            except ShopError as err:
                raise ShopError(f"Nothing was added. {err}") from None
    return sum(s.quantity for s in wanted)


def update_cart_line(user_id: int, line_id: int, quantity: int) -> None:
    with get_db() as con:
        line = con.execute(
            "SELECT * FROM cart_items WHERE user_id = ? AND id = ?", (user_id, line_id)
        ).fetchone()
        if line is None:
            raise ShopError("That item isn't in your cart.")
        _check_stock(con, user_id, line["product_id"], line["size"], quantity, ignore_line=line_id)
        con.execute("UPDATE cart_items SET quantity = ? WHERE id = ?", (quantity, line_id))


def remove_cart_line(user_id: int, line_id: int) -> None:
    with get_db() as con:
        con.execute("DELETE FROM cart_items WHERE user_id = ? AND id = ?", (user_id, line_id))


# --- Guest → account --------------------------------------------------------------------


def merge_guest_state(user_id: int, guest: ShopMerge) -> list[str]:
    """Add what a guest collected to their account. Returns notes about anything skipped
    (e.g. an item that sold out while they were browsing) instead of failing the login."""
    skipped = []
    with get_db() as con:
        # Guest lists are newest first; add oldest first so the newest stays on top.
        for product_id in reversed(guest.wishlist):
            try:
                product = _product(con, product_id)
            except ShopError:
                continue
            con.execute(
                "INSERT OR IGNORE INTO wishlist_items (user_id, product_id) VALUES (?, ?)",
                (user_id, product["product_id"]),
            )
        for design in guest.designs:
            _save_design(con, user_id, design)
        for item in guest.cart:
            try:
                _add_to_cart(con, user_id, item, from_guest=True)
            except ShopError as err:
                skipped.append(f"{item.product_id} ({item.size}): {err}")
    return skipped


# --- Shared wishlist links ----------------------------------------------------------------


def create_wishlist_share(share: WishlistShareCreate) -> str:
    """Save a snapshot of a wishlist and return the token for its link.

    Anyone can make one (guests too). Only what the owner chose to share is stored: a
    display name, a note, and the items with their size and embroidery; never an account
    id or email. The name and note go through privacy.redact() like chat messages, and
    the token is random (72 bits), so links can't be guessed.
    """
    items: list[SharedItem] = []
    with get_db() as con:
        for item in share.items:
            try:
                product = _product(con, item.product_id)
            except ShopError:
                continue  # no longer in the catalogue: leave it off the shared list
            product_id = product["product_id"]
            if any(i.product_id == product_id for i in items):
                continue
            size = None
            if item.size:
                size = normalize_size(item.size)
                offered = con.execute(
                    "SELECT 1 FROM inventory WHERE product_id = ? AND size = ?", (product_id, size)
                ).fetchone()
                if offered is None:
                    raise ShopError(f"{product['name']} doesn't come in size {size}.")
            embroidery = item.embroidery
            if embroidery:
                if embroidery.location not in _allowed_locations(product):
                    raise ShopError(f"Embroidery isn't offered in that spot on {product['name']}.")
                if embroidery.thread_color is None:
                    embroidery = embroidery.model_copy(update={"thread_color": DEFAULT_THREAD})
            items.append(SharedItem(product_id=product_id, size=size, embroidery=embroidery))
        if not items:
            raise ShopError("There's nothing on this wishlist to share.")

        owner = redact(share.owner_name).text.strip() if share.owner_name else ""
        note = redact(share.note).text.strip() if share.note else ""
        token = secrets.token_urlsafe(9)
        con.execute(
            "INSERT INTO shared_wishlists (token, owner_name, note, items_json) VALUES (?, ?, ?, ?)",
            (token, owner or None, note or None, json.dumps([i.model_dump() for i in items])),
        )
    return token


def get_wishlist_share(token: str) -> SharedWishlist | None:
    with get_db() as con:
        row = con.execute("SELECT * FROM shared_wishlists WHERE token = ?", (token,)).fetchone()
    if row is None:
        return None
    return SharedWishlist(
        owner_name=row["owner_name"],
        note=row["note"],
        created_at=row["created_at"],
        items=[SharedItem.model_validate(i) for i in json.loads(row["items_json"])],
    )
