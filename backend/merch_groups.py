"""Merchandise groups for the second row of the site header: residential colleges, sports,
graduate and professional schools, and family.

Each product gets group keys like "college:pierson" or "sport:ice-hockey" from its name and
description (product_groups), and GET /api/groups lists every option that has at least one
product (group_menu), so the menus never offer an empty page.

Sports are matched on the description only: it was written from the product photo, while a
few names are misleading (e.g. "Squash Left Chest Tennis" is a squash shirt, and the
"2025 Yale Vs Harvard T Shirt" is a football shirt for The Game).
"""

from __future__ import annotations

import re
import sqlite3

from models import MenuGroup, MenuOption

# (option key, label, pattern). Order is the order shown in the menu.
COLLEGES = [
    ("benjamin-franklin", "Benjamin Franklin", r"benjamin franklin"),
    ("berkeley", "Berkeley", r"berkeley"),
    ("branford", "Branford", r"branford"),
    ("davenport", "Davenport", r"davenport"),
    ("ezra-stiles", "Ezra Stiles", r"ezra stiles"),
    ("grace-hopper", "Grace Hopper", r"grace hopper"),
    ("jonathan-edwards", "Jonathan Edwards", r"jonathan edwards"),
    ("morse", "Morse", r"morse"),
    ("pauli-murray", "Pauli Murray", r"pauli murray"),
    ("pierson", "Pierson", r"pierson"),
    ("saybrook", "Saybrook", r"saybrook"),
    ("silliman", "Silliman", r"silliman"),
    ("timothy-dwight", "Timothy Dwight", r"timothy dwight"),
    ("trumbull", "Trumbull", r"trumbull"),
]

SPORTS = [
    ("baseball", "Baseball", r"baseball"),
    ("basketball", "Basketball", r"basketball"),
    ("crew", "Crew (rowing)", r"yale crew"),
    ("diving", "Diving", r"diving"),
    ("fencing", "Fencing", r"fencing"),
    ("field-hockey", "Field Hockey", r"field hockey"),
    ("football", "Football", r"football"),
    ("golf", "Golf", r"golf"),
    ("ice-hockey", "Ice Hockey", r"(?<!field )hockey"),
    ("lacrosse", "Lacrosse", r"lacrosse"),
    ("sailing", "Sailing", r"sailing"),
    ("soccer", "Soccer", r"soccer"),
    ("squash", "Squash", r"squash"),
    ("swimming", "Swimming", r"swimming"),
    ("tennis", "Tennis", r"tennis"),
    ("track-and-field", "Track & Field", r"track (?:&|and) field"),
    ("volleyball", "Volleyball", r"volleyball"),
]

SCHOOLS = [
    ("architecture", "School of Architecture", r"school of architecture"),
    ("art", "School of Art", r"school of art\b"),
    ("divinity", "Divinity School", r"divinity school"),
    ("engineering", "School of Engineering & Applied Science", r"school of engineering"),
    ("environment", "School of the Environment (The Forest School)", r"forest school"),
    ("law", "Law School", r"law school"),
    ("management", "School of Management (SOM)", r"school of management"),
    ("medicine", "School of Medicine", r"school of medicine"),
    ("music", "School of Music", r"school of music"),
    ("nursing", "School of Nursing", r"school of nursing"),
    ("public-health", "School of Public Health", r"school of public health"),
]

FAMILY = [
    ("mom", "Mom", r"\bmom\b"),
    ("dad", "Dad", r"\bdad\b"),
    ("brother", "Brother", r"\bbrother\b(?!s)"),
    ("sister", "Sister", r"\bsister\b"),
    ("grandma", "Grandma", r"\bgrandma\b"),
    ("grandpa", "Grandpa", r"\bgrandpa\b"),
    ("aunt", "Aunt", r"\baunt\b"),
    ("uncle", "Uncle", r"\buncle\b"),
    ("cousin", "Cousin", r"\bcousin\b"),
]

# (group key, menu label, options, which text to match)
GROUPS = [
    ("college", "Residential Colleges", COLLEGES, "name+description"),
    ("sport", "Sports", SPORTS, "description"),
    ("school", "Graduate & Professional Schools", SCHOOLS, "name+description"),
    ("family", "Family", FAMILY, "name"),
]

_COMPILED = [
    (group, field, [(key, re.compile(pattern, re.I)) for key, _, pattern in options])
    for group, _, options, field in GROUPS
]


def product_groups(name: str, description: str) -> list[str]:
    """Group keys for one product, e.g. ["college:pierson"] or ["sport:ice-hockey"]."""
    found = []
    for group, field, options in _COMPILED:
        text = {"name": name, "description": description, "name+description": f"{name} {description}"}[field]
        for key, pattern in options:
            if pattern.search(text):
                found.append(f"{group}:{key}")
    return found


def group_menu(rows: list[sqlite3.Row]) -> list[MenuGroup]:
    """The header menus: every option with at least one product, and how many it has."""
    counts: dict[str, int] = {}
    for row in rows:
        for key in product_groups(row["name"], row["description"]):
            counts[key] = counts.get(key, 0) + 1
    menu = []
    for group, label, options, _ in GROUPS:
        items = [
            MenuOption(key=f"{group}:{key}", label=option_label, count=counts[f"{group}:{key}"])
            for key, option_label, _ in options
            if counts.get(f"{group}:{key}")
        ]
        menu.append(MenuGroup(key=group, label=label, count=sum(o.count for o in items), options=items))
    return menu


_LABELS = {f"{group}:{key}": label for group, _, options, _ in GROUPS for key, label, _ in options}


def group_label(key: str) -> str:
    """How a group reads in a sentence, matching the site's group page headings:
    "Pierson College", "Yale Ice Hockey", "Law School", "Yale Dad"."""
    group, _, _ = key.partition(":")
    label = _LABELS.get(key, key)
    if group == "college":
        return f"{label} College"
    if group in ("sport", "family"):
        return f"Yale {label}"
    return label
