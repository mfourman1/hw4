"""Corrections to item descriptors in the seed catalogue (data/campus_customs.db).

Applied at server start (main.py). Each fix only changes a row that still has the old,
wrong value, so it's safe to run every time, and a fresh copy of the seed database gets
fixed too.

- Three products had a placeholder instead of a real description ("Vision blocked;
  filename-based stub"), no colors, filename-based search tags, and generic garment
  types. They were rewritten from the product photos.
- One quarter-zip was named "School Of Architecture Crewneck".
"""

from __future__ import annotations

import json

from tools import get_db

PLACEHOLDER = "%Vision blocked; filename-based stub%"

DESCRIPTOR_FIXES = {
    "benjamin-franklin-t-shirt": {
        "garment_type": "short-sleeve t-shirt",
        "colors": ["heather gray", "red", "blue", "black"],
        "search_tags": ["Yale", "Benjamin Franklin College", "Ben Franklin", "residential college",
                        "college crest", "t-shirt", "tee", "heather gray", "college merch"],
        "description": "Heather gray short-sleeve crew-neck T-shirt featuring a centered red-and-blue "
                       "Benjamin Franklin College shield crest with fleurs-de-lis, and BENJAMIN "
                       "FRANKLIN COLLEGE text beneath.",
    },
    "berkeley-sweater-fleece-jacket": {
        "garment_type": "full-zip fleece jacket",
        "colors": ["heather gray", "charcoal gray", "red"],
        "search_tags": ["Yale", "Berkeley College", "residential college", "fleece jacket",
                        "sweater fleece", "full zip", "college crest", "heather gray", "college merch"],
        "description": "Heather gray full-zip sweater fleece jacket with a stand collar, charcoal gray "
                       "zipper and pocket trim, and a small red Berkeley College crest with BERKELEY "
                       "text on the left chest.",
    },
    "timothy-dwight-college-crewneck": {
        "garment_type": "crewneck sweatshirt",
        "colors": ["heather gray", "red", "black"],
        "search_tags": ["Yale", "Timothy Dwight College", "TD", "residential college", "crewneck",
                        "sweatshirt", "college crest", "heather gray", "college merch"],
        "description": "Heather gray long-sleeve crewneck sweatshirt with ribbed collar, cuffs, and "
                       "waistband, featuring a small red Timothy Dwight College crest and TIMOTHY "
                       "DWIGHT text on the left chest.",
    },
}


def apply_catalogue_fixes() -> list[str]:
    """Apply any fixes the database still needs. Returns the product_ids that changed."""
    changed = []
    with get_db() as con:
        for product_id, fix in DESCRIPTOR_FIXES.items():
            cur = con.execute(
                "UPDATE catalogue SET garment_type = ?, colors = ?, search_tags = ?, description = ? "
                "WHERE product_id = ? AND description LIKE ?",
                (fix["garment_type"], json.dumps(fix["colors"]), json.dumps(fix["search_tags"]),
                 fix["description"], product_id, PLACEHOLDER),
            )
            if cur.rowcount:
                changed.append(product_id)
        cur = con.execute(
            "UPDATE catalogue SET name = 'School Of Architecture 1 4 Zip' "
            "WHERE product_id = 'school-of-architecture-crewneck' AND name = 'School Of Architecture Crewneck'"
        )
        if cur.rowcount:
            changed.append("school-of-architecture-crewneck")
    return changed
