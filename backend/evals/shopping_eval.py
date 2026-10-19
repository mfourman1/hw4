"""Tests for the fit finder, in-stock alternatives, group orders, and shared wishlist links.

Run from the backend/ folder:

    python evals/shopping_eval.py

Group orders and share links write to the database, so those checks run on a temporary
copy of data/campus_customs.db; the real database isn't changed. Exits with status 1 if
any check fails.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import tools  # noqa: E402
from models import Embroidery, GroupOrder, GroupOrderSize, SharedItem, WishlistShareCreate  # noqa: E402

failures: list[str] = []
passed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  pass  {name}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}  {detail}")


# --- The size chart matches the Home page size guide -------------------------------------
print("Size chart")
from sizing import CHEST, FIT_NOTES, SIZES, recommend_size, size_for_chest  # noqa: E402

guide = (tools.ROOT / "frontend" / "src" / "components" / "SizeGuide.tsx").read_text(encoding="utf-8")
for chart, tsx_key in (("unisex", "mens"), ("womens", "womens")):
    block = re.search(rf"{tsx_key}: \{{\s*chest: \{{[^}}]*inches: (\[\[.*?\]\])", guide, re.S)
    rows = [tuple(float(x) for x in pair) for pair in re.findall(r"\[([\d.]+), ([\d.]+)\]", block.group(1))]
    check(f"{chart} chest ranges match SizeGuide.tsx", rows == [tuple(map(float, r)) for r in CHEST[chart]], str(rows))
for kind, note in FIT_NOTES.items():
    check(f"{kind} fit note matches SizeGuide.tsx", " ".join(note.split()) in " ".join(guide.split()))

# --- recommend_size --------------------------------------------------------------------
print("recommend_size")
SWEATSHIRT, TEE, JACKET = "pierson-college-crewneck", "football-left-chest-t-shirt", "saybrook-sweater-fleece-jacket"
cases = [
    ("usual M", dict(product_id=SWEATSHIRT, usual_size="medium"), "M"),
    ("usual M, roomy", dict(product_id=SWEATSHIRT, usual_size="M", fit="roomy"), "L"),
    ("usual M, fitted sweatshirt sizes down", dict(product_id=SWEATSHIRT, usual_size="M", fit="fitted"), "S"),
    ("usual M, fitted tee stays", dict(product_id=TEE, usual_size="M", fit="fitted"), "M"),
    ("usual M, fitted jacket stays", dict(product_id=JACKET, usual_size="M", fit="fitted"), "M"),
    ("women's M is a unisex S", dict(product_id=SWEATSHIRT, usual_size="M", size_chart="womens"), "S"),
    ("women's L is a unisex M", dict(product_id=SWEATSHIRT, usual_size="large", size_chart="womens"), "M"),
    ('39" chest is M', dict(product_id=SWEATSHIRT, chest_inches=39), "M"),
    ('37.5" chest (between S and M) is M', dict(product_id=SWEATSHIRT, chest_inches=37.5), "M"),
    ('52" chest caps at XXL', dict(product_id=SWEATSHIRT, chest_inches=52), "XXL"),
    ("usual XXL, roomy stays XXL", dict(product_id=SWEATSHIRT, usual_size="XXL", fit="roomy"), "XXL"),
]
for name, kwargs, expected in cases:
    advice = recommend_size(**kwargs)
    check(name, advice.recommended_size == expected, f"got {advice.recommended_size}: {advice.reason}")

with sqlite3.connect(tools.DB_PATH) as con:
    stock = dict(con.execute("SELECT size, quantity FROM inventory WHERE product_id = ?", (SWEATSHIRT,)).fetchall())
advice = recommend_size(SWEATSHIRT, usual_size="M")
check("stock quantity comes from inventory", advice.recommended_size_quantity == stock["M"])
check("available sizes are the ones in stock", advice.available_sizes == [s for s in SIZES if stock.get(s, 0) > 0])
check("size_for_chest below the chart is XS", size_for_chest(28) == "XS")

# --- similar_in_stock / alternatives -----------------------------------------------------
print("similar_in_stock")
from recommend import similar_in_size, similar_in_stock  # noqa: E402

with tools.get_db() as con:
    sold_out = con.execute(
        "SELECT product_id, size FROM inventory WHERE quantity = 0 ORDER BY product_id, size"
    ).fetchall()
    bad = []
    for row in sold_out:
        for alt, _ in similar_in_size(con, row["product_id"], row["size"]):
            qty = con.execute(
                "SELECT quantity FROM inventory WHERE product_id = ? AND size = ?", (alt["product_id"], row["size"])
            ).fetchone()[0]
            if qty <= 0 or alt["product_id"] == row["product_id"]:
                bad.append((row["product_id"], row["size"], alt["product_id"]))
check(f"all alternatives for {len(sold_out)} sold-out sizes are in stock and not the same item", not bad, str(bad[:3]))

alts = similar_in_stock("yale-dad-hoodie", "M")
check("Yale Dad hoodie: first alternative is more Yale Dad gear", alts and alts[0].why == "Also Yale Dad", str(alts[:1]))
alts = similar_in_stock("pierson-college-crewneck", "L")
check("Pierson crewneck: Pierson item first, then crewnecks",
      alts[0].why == "Also Pierson College" and all(a.why == "Another crewneck" for a in alts[1:]), str(alts))

# --- Group orders and share links (temporary database copy) ----------------------------
print("Group orders and share links")
import shop  # noqa: E402

tmp = Path(tempfile.mkdtemp()) / "campus_customs.db"
shutil.copy(tools.DB_PATH, tmp)
tools.DB_PATH = tmp  # get_db() reads this on every call
tools.ensure_schema()
with tools.get_db() as con:
    user_id = con.execute(
        "INSERT INTO users (name, first_name, last_name, email, password_hash) VALUES "
        "('Eval Shopper', 'Eval', 'Shopper', 'eval@example.com', 'x')"
    ).lastrowid
    stock = dict(con.execute("SELECT size, quantity FROM inventory WHERE product_id = ?", (SWEATSHIRT,)).fetchall())

in_stock = [s for s in SIZES if stock[s] >= 2]
design = Embroidery(text="Pierson IM Soccer", location="left_chest", thread_color="Gold")
order = GroupOrder(
    product_id=SWEATSHIRT,
    color="navy",
    sizes=[GroupOrderSize(size=s, quantity=2) for s in in_stock[:2]],
    embroidery=design,
)
added = shop.add_group_order(user_id, order)
cart = shop.get_shop_state(user_id).cart
check("group order adds one line per size", added == 4 and len(cart) == 2 and {l.size for l in cart} == set(in_stock[:2]))
check("every line has the embroidery", all(l.embroidery and l.embroidery.text == "Pierson IM Soccer" for l in cart))

# One size is fine, the other asks for more than the shop has.
short = next(s for s in SIZES if s != in_stock[-1])
too_many = GroupOrder(
    product_id=SWEATSHIRT,
    color="navy",
    sizes=[GroupOrderSize(size=in_stock[-1], quantity=1), GroupOrderSize(size=short, quantity=stock[short] + 1)],
)
try:
    shop.add_group_order(user_id, too_many)
    check("short stock in one size adds nothing", False, "no error")
except shop.ShopError as err:
    after = shop.get_shop_state(user_id).cart
    check("short stock in one size adds nothing", len(after) == 2 and str(err).startswith("Nothing was added."), str(err))

token = shop.create_wishlist_share(
    WishlistShareCreate(
        owner_name="Eval",
        note="Size M please! My card is 4111 1111 1111 1111",
        items=[
            SharedItem(product_id=SWEATSHIRT, size="medium", embroidery=Embroidery(text="Eval 27", location="left_chest")),
            SharedItem(product_id="yale-dad-hoodie"),
            SharedItem(product_id="not-a-real-product"),
            SharedItem(product_id=SWEATSHIRT),
        ],
    )
)
shared = shop.get_wishlist_share(token)
check("share token is long and URL-safe", len(token) >= 12 and re.fullmatch(r"[A-Za-z0-9_-]+", token) is not None, token)
check("shared list keeps sizes, drops unknown and repeated items",
      [(i.product_id, i.size) for i in shared.items] == [(SWEATSHIRT, "M"), ("yale-dad-hoodie", None)], str(shared.items))
check("older designs get a thread color", shared.items[0].embroidery.thread_color == "White")
check("card numbers are removed from the note", "4111" not in (shared.note or "") and "removed" in (shared.note or ""), shared.note)
with tools.get_db() as con:
    columns = {r["name"] for r in con.execute("PRAGMA table_info(shared_wishlists)")}
check("no account id or email is stored with a share", not columns & {"user_id", "email"}, str(columns))
check("unknown token returns nothing", shop.get_wishlist_share("nope") is None)
try:
    shop.create_wishlist_share(WishlistShareCreate(items=[SharedItem(product_id=SWEATSHIRT, size="XXXL")]))
    check("a size the item isn't made in is refused", False, "no error")
except shop.ShopError:
    check("a size the item isn't made in is refused", True)

print(f"\n{passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
