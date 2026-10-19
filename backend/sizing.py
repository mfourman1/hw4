"""Size advice for the chat's fit finder (the agent's recommend_size tool).

The chart is the same one the Home page size guide shows
(frontend/src/components/SizeGuide.tsx); evals/fit_eval.py checks the two still match.
Our garments are a unisex cut, so sizes are given on the unisex chart:

    chest measurement   -> the unisex size whose chest range fits it
    usual unisex size   -> that size
    usual women's size  -> the unisex size for the middle of that women's bust range
                           (a women's M, bust 35-36", is a unisex S)

then adjusted for how the shopper likes things to fit, and checked against stock.
"""

from __future__ import annotations

from pydantic_ai import ModelRetry

from models import FitPreference, SizeAdvice, SizeChart
from tools import _catalogue_row, _size_status, garment_categories, get_db, normalize_size, size_sort_key

SIZES = ["XS", "S", "M", "L", "XL", "XXL"]

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
