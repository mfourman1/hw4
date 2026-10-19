"""Test set for search_products: does the agent's search find what shoppers mean?

Run from the backend/ folder:

    python evals/search_eval.py

Each case is a shopper-style query plus the right answer, worked out from the catalogue's
own labels (garment_type, colors, name), not from the search code. Two scores per case:

    recall     share of the right products that search returns (limit 30)
    precision  share of the top results (top 5, or fewer if fewer are right) that are right

A case passes when it meets its targets. The script exits with status 1 if any case fails,
so it can be re-run after every search change.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import DB_PATH, search_products  # noqa: E402

Row = dict


def gt(row: Row) -> str:
    return row["garment_type"].lower()


def colors(row: Row) -> str:
    return " ".join(row["colors"]).lower()


def is_tshirt(r: Row) -> bool:
    return "t-shirt" in gt(r)


def is_hoodie(r: Row) -> bool:
    return "hood" in gt(r)


def is_crewneck(r: Row) -> bool:
    return "crew" in gt(r) and "t-shirt" not in gt(r)


def is_quarter_zip(r: Row) -> bool:
    return "quarter-zip" in gt(r)


def is_jacket(r: Row) -> bool:
    return "jacket" in gt(r)


def name_has(word: str) -> Callable[[Row], bool]:
    return lambda r: word.lower() in r["name"].lower()


@dataclass
class Case:
    query: str
    right: Callable[[Row], bool]
    min_recall: float = 1.0
    min_precision: float = 1.0
    note: str = ""


CASES = [
    # Garment types, in the words shoppers use
    Case("tees", is_tshirt, note="slang for t-shirts"),
    Case("do you have any t-shirts", is_tshirt),
    Case("tshirt", is_tshirt, note="no hyphen"),
    Case("hoodies", is_hoodie),
    Case("hoody", is_hoodie, note="spelling variant"),
    Case("hooded sweatshirt", is_hoodie),
    Case("crewnecks", is_crewneck),
    Case("quarter zip", is_quarter_zip),
    Case("1/4 zip", is_quarter_zip, note="how the product names write it"),
    Case("jackets", is_jacket),
    # Type + color
    Case("grey hoodie", lambda r: is_hoodie(r) and "gray" in colors(r), min_recall=0.8, note="UK spelling of gray"),
    Case("gray crewneck", lambda r: is_crewneck(r) and "gray" in colors(r), min_recall=0.8),
    Case("navy hoodie", lambda r: is_hoodie(r) and "navy" in colors(r), min_recall=0.8),
    # Colleges, schools, sports, family
    Case("Pierson", name_has("pierson")),
    Case("Pierson crewneck", lambda r: r["product_id"] == "pierson-college-crewneck"),
    Case("hockey", name_has("hockey")),
    Case("something for my dad", name_has("dad")),
    Case("school of art", name_has("school of art")),
    Case("Harvard game tee", lambda r: r["product_id"] == "2025-yale-vs-harvard-t-shirt"),
    Case("bulldog", lambda r: "bulldog" in (r["name"] + " " + r["description"]).lower(), min_precision=0.8),
    Case("long sleeve shirt", lambda r: "long-sleeve" in gt(r)),
    # Depends on the item's own descriptors (colors), not just its name
    Case("gray fleece", lambda r: "fleece" in (gt(r) + " " + r["name"].lower()) and "gray" in colors(r),
         note="needs every fleece to list its colors"),
]


def load_catalogue() -> list[Row]:
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT * FROM catalogue")]
    for r in rows:
        r["colors"] = json.loads(r["colors"])
    return rows


def score(case: Case, catalogue: list[Row]) -> tuple[float, float, int, int]:
    right = {r["product_id"] for r in catalogue if case.right(r)}
    found = [p.product_id for p in search_products(case.query, 30)]
    recall = len(right & set(found)) / len(right) if right else 1.0
    k = min(5, len(right))
    top = found[:k]
    precision = sum(pid in right for pid in top) / k if k else 1.0
    return recall, precision, len(right), len(found)


def main() -> int:
    catalogue = load_catalogue()
    passed = 0
    total_recall = total_precision = 0.0
    print(f"{'query':28} {'right':>5} {'found':>5} {'recall':>7} {'prec@5':>7}  result")
    for case in CASES:
        recall, precision, n_right, n_found = score(case, catalogue)
        ok = recall >= case.min_recall and precision >= case.min_precision
        passed += ok
        total_recall += recall
        total_precision += precision
        note = f"  ({case.note})" if case.note else ""
        print(f"{case.query!r:28} {n_right:5} {n_found:5} {recall:7.0%} {precision:7.0%}  "
              f"{'PASS' if ok else 'FAIL'}{note}")
    n = len(CASES)
    print(f"\n{passed}/{n} cases pass · average recall {total_recall / n:.0%} · "
          f"average precision@5 {total_precision / n:.0%}")
    return 0 if passed == n else 1


if __name__ == "__main__":
    sys.exit(main())
