"""Data types for the Campus Customs backend (Pydantic models; AgentReply is the PydanticAI output)."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from safety import embroidery_problem

# --- Products ---------------------------------------------------------------------------


class ProductSummary(BaseModel):
    """One card on the Products page."""

    product_id: str
    name: str
    garment_type: str
    price: float
    short_description: str
    image_url: str
    categories: list[str] = Field(
        default_factory=list,
        description="Garment kinds (t-shirt, hoodie, crewneck, quarter-zip, jacket, fleece, ...) for shop filters.",
    )
    groups: list[str] = Field(
        default_factory=list,
        description="Merchandise groups, e.g. 'college:pierson', 'sport:ice-hockey', 'school:law', 'family:dad'.",
    )


class AlternativeProduct(ProductSummary):
    """A similar product that's in stock in the size the shopper wanted (recommend.py)."""

    why: str = Field(description="e.g. 'Also Pierson College' or 'Another crewneck'")


class MenuOption(BaseModel):
    key: str = Field(description="e.g. 'college:pierson'")
    label: str
    count: int


class MenuGroup(BaseModel):
    """One menu in the header's second row (colleges, sports, schools, family)."""

    key: str = Field(description="'college', 'sport', 'school', or 'family'")
    label: str
    count: int
    options: list[MenuOption]


class SizeStock(BaseModel):
    size: str
    quantity: int


EmbroideryLocation = Literal["left_chest", "right_chest", "shoulder"]


class EmbroideryOption(BaseModel):
    location: EmbroideryLocation
    label: str = Field(description="What the shopper sees, e.g. 'Left chest, below the logo'.")


class ProductDetail(BaseModel):
    """Everything the single-item page shows."""

    product_id: str
    name: str
    garment_type: str
    price: float
    description: str
    colors: list[str]
    search_tags: list[str]
    image_url: str
    sizes: list[SizeStock]
    total_in_stock: int
    embroidery_options: list[EmbroideryOption] = Field(
        description="Where this product can be embroidered. Empty when it has a large central design."
    )
    embroidery_price: float
    categories: list[str] = Field(default_factory=list, description="Garment kinds, as in ProductSummary.")
    groups: list[str] = Field(default_factory=list, description="Merchandise groups, as in ProductSummary.")
    colorway: str = Field(description="The garment's main color (the first entry in `colors`).")
    color_options: list[str] = Field(
        description=(
            "Colors the shopper can choose from. Every current product comes in one color, so this "
            "has one entry and the site selects it automatically; a product sold in several colors "
            "would list them all here and the shopper would pick one."
        )
    )
    thread_colors: list[str] = Field(description="Thread colors offered for embroidery.")


# --- Wishlist, cart, and embroidery designs ----------------------------------------------

EMBROIDERY_MAX_CHARS = 20
EMBROIDERY_PATTERN = re.compile(r"^[A-Za-z0-9 &'.!#\-]+$")
MAX_CART_QUANTITY = 10  # the product page's quantity picker for a single order
MAX_LINE_QUANTITY = 50  # most units on one cart line (group orders); stock is usually the real limit
ThreadColor = Literal["White", "Navy", "Yale blue", "Gray", "Black", "Gold"]


class Embroidery(BaseModel):
    """Custom text stitched on a garment: where, and in which thread color."""

    text: str = Field(min_length=1, max_length=EMBROIDERY_MAX_CHARS)
    location: EmbroideryLocation
    thread_color: ThreadColor | None = Field(
        default=None,
        description="Required when adding to the cart; only older saved designs may lack it.",
    )

    @field_validator("text", mode="before")
    @classmethod
    def clean_text(cls, value: str) -> str:
        if not isinstance(value, str):
            return value
        value = " ".join(value.split())  # trim and collapse spaces
        if value and not EMBROIDERY_PATTERN.match(value):
            raise ValueError("Embroidery can use letters, numbers, spaces, and & ' . ! # -")
        # Safety rule 12: no profanity, slurs, or personal contact details on a garment.
        if value and (problem := embroidery_problem(value)):
            raise ValueError(problem)
        return value


class EmbroideryCheckRequest(BaseModel):
    text: str = Field(max_length=200)


class EmbroideryCheck(BaseModel):
    """Whether embroidery text is allowed (safety rule 12), and why not if it isn't."""

    ok: bool
    problem: str | None = None


class EmbroideryDesign(Embroidery):
    """A saved design the shopper can reuse on other garments."""

    id: str


class CartLine(BaseModel):
    id: str
    product_id: str
    size: str
    color: str
    quantity: int
    embroidery: Embroidery | None = None


class ShopState(BaseModel):
    """A logged-in shopper's wishlist, cart, and saved designs (the same shape guests keep in the browser)."""

    wishlist: list[str] = Field(description="product_ids, most recently added first")
    cart: list[CartLine]
    designs: list[EmbroideryDesign]


class WishlistAdd(BaseModel):
    product_id: str = Field(max_length=120)


class CartAdd(BaseModel):
    product_id: str = Field(max_length=120)
    size: str = Field(max_length=10)
    color: str | None = Field(
        default=None, max_length=40,
        description="The colorway the shopper confirmed. Required when adding from the product page.",
    )
    quantity: int = Field(default=1, ge=1, le=MAX_LINE_QUANTITY)
    embroidery: Embroidery | None = None
    save_design: bool = Field(default=True, description="Also save the embroidery for reuse.")


class CartUpdate(BaseModel):
    quantity: int = Field(ge=1, le=MAX_LINE_QUANTITY)


class GroupOrderSize(BaseModel):
    size: str = Field(max_length=10)
    quantity: int = Field(ge=0, le=MAX_LINE_QUANTITY)


class GroupOrder(BaseModel):
    """A group order (team, club, or event): one product and one embroidery design, many sizes.

    Added to the cart as one line per size, all at once: if any size doesn't have enough
    stock, nothing is added.
    """

    product_id: str = Field(max_length=120)
    color: str | None = Field(default=None, max_length=40)
    sizes: list[GroupOrderSize] = Field(min_length=1, max_length=6)
    embroidery: Embroidery | None = None
    save_design: bool = True


# --- Shared wishlist links ----------------------------------------------------------------

MAX_SHARED_ITEMS = 50
MAX_SHARE_NOTE_CHARS = 300


class SharedItem(BaseModel):
    """One item on a shared wishlist, with the size (and embroidery) its owner wants."""

    product_id: str = Field(max_length=120)
    size: str | None = Field(default=None, max_length=10, description="The owner's size, if they chose one.")
    embroidery: Embroidery | None = None


class WishlistShareCreate(BaseModel):
    """What the wishlist page sends to make a share link. Works for guests too."""

    owner_name: str | None = Field(default=None, max_length=50)
    note: str | None = Field(default=None, max_length=MAX_SHARE_NOTE_CHARS)
    items: list[SharedItem] = Field(min_length=1, max_length=MAX_SHARED_ITEMS)


class WishlistShareLink(BaseModel):
    token: str
    path: str = Field(description="Where the shared list opens on the site, e.g. /wishlist/shared/<token>.")


class SharedWishlist(BaseModel):
    """A shared wishlist as family and friends see it: no account details, only what the owner chose to share."""

    owner_name: str | None
    note: str | None
    created_at: str
    items: list[SharedItem]


class ShopMerge(BaseModel):
    """What a guest collected before logging in, to add to their account."""

    wishlist: list[str] = Field(default_factory=list, max_length=100)
    cart: list[CartAdd] = Field(default_factory=list, max_length=50)
    designs: list[Embroidery] = Field(default_factory=list, max_length=20)


# --- Accounts ---------------------------------------------------------------------------

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    # Emails are stored lowercase so "Test@..." and "test@..." are the same account.
    value = value.strip().lower()
    if not EMAIL_PATTERN.match(value):
        raise ValueError("Enter a valid email address.")
    return value


class SignupRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return normalize_email(value)


class LoginRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.strip().lower()


class UserOut(BaseModel):
    """What the front end gets back about a signed-in user. Never includes the password hash."""

    id: int
    first_name: str
    last_name: str
    email: str


# --- Chat -------------------------------------------------------------------------------

MAX_CHAT_MESSAGE_CHARS = 1000
MAX_CHAT_CARDS = 4  # cards shown inside the chat panel for a specific-product answer
MAX_PAGE_RESULTS = 30  # cards the chat can put on the page for a browsing search
MAX_GUEST_HISTORY = 20  # earlier messages a guest's browser may send (10 back-and-forths)
MAX_HISTORY_MESSAGE_CHARS = 2000


class PageContext(BaseModel):
    """Where the shopper is on the site. The chat widget sends this with every message."""

    path: str = Field(default="/", max_length=300)
    product_id: str | None = Field(
        default=None, max_length=120, description="Set when the shopper is on a product page."
    )


class HistoryMessage(BaseModel):
    """One earlier message in a guest's conversation (guests' chats live only in the browser)."""

    role: Literal["user", "assistant"]
    content: str

    @field_validator("content", mode="before")
    @classmethod
    def trim_content(cls, value: str) -> str:
        return value[:MAX_HISTORY_MESSAGE_CHARS] if isinstance(value, str) else value


class ChatRequest(BaseModel):
    """What the chat widget sends to POST /api/chat."""

    message: str = Field(min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS)
    page: PageContext = Field(default_factory=PageContext)
    history: list[HistoryMessage] = Field(
        default_factory=list,
        description=(
            "Guests only: the conversation so far, from the browser. Ignored for logged-in "
            "shoppers, whose history is read from the database instead."
        ),
    )

    @field_validator("message", mode="before")
    @classmethod
    def strip_message(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("history")
    @classmethod
    def keep_recent_history(cls, value: list[HistoryMessage]) -> list[HistoryMessage]:
        return value[-MAX_GUEST_HISTORY:]


# --- What the agent knows about this chat (its deps) -------------------------------------


class CustomerInfo(BaseModel):
    """The logged-in shopper, as the agent sees them. Only name and email, never the password hash."""

    first_name: str
    last_name: str
    email: str


PageType = Literal["home", "products", "product", "about", "login", "create_account", "other"]


class PageInfo(BaseModel):
    """The page the shopper is on, checked against the database by tools.resolve_page()."""

    page_type: PageType
    product: ProductDescription | None = Field(
        default=None, description="The product on screen when page_type is 'product'."
    )


class ChatDeps(BaseModel):
    """Per-message context handed to the agent as its deps (RunContext.deps)."""

    customer: CustomerInfo | None = Field(description="None when the shopper is a guest.")
    page: PageInfo


class ProductMatch(BaseModel):
    """One search result the agent sees from search_products: enough to pick candidates.

    Price and stock are left out on purpose, so the agent has to call get_price or
    check_stock (which read the database at that moment) before quoting them.
    """

    product_id: str
    name: str
    garment_type: str
    colors: list[str]
    short_description: str


# --- Agent lookup tools (return types) --------------------------------------------------


class ProductDescription(BaseModel):
    """Returned by get_product_description: the full catalogue text for one product."""

    product_id: str
    name: str
    garment_type: str
    description: str = Field(description="Full description from the catalogue.")
    colors: list[str] = Field(
        description="Every color on this one garment (body, trim, design), not separate color options."
    )


class ProductPrice(BaseModel):
    """Returned by get_price: the current price for one product."""

    product_id: str
    name: str
    price: float = Field(description="Price in US dollars, straight from the catalogue.")


StockStatus = Literal["in_stock", "low_stock", "sold_out", "not_offered"]


class StockReport(BaseModel):
    """Returned by check_stock: units on hand for one product, by size."""

    product_id: str
    name: str
    requested_size: str | None = Field(
        description="The size the shopper asked about, as a standard size (XS-XXL). None if no size was asked."
    )
    requested_size_status: StockStatus | None = Field(
        description=(
            "in_stock, low_stock (5 or fewer left), sold_out (0 left), or not_offered "
            "(we don't make that size). None if no size was asked."
        )
    )
    requested_size_quantity: int | None = Field(
        description="Units on hand in the requested size. None if no size was asked or it isn't offered."
    )
    sizes: list[SizeStock] = Field(description="Units on hand for every size, XS to XXL.")
    available_sizes: list[str] = Field(description="Sizes with at least 1 unit in stock.")
    sold_out_sizes: list[str] = Field(description="Sizes with 0 units in stock.")
    total_in_stock: int = Field(description="Units on hand across all sizes.")


FitPreference = Literal["regular", "fitted", "roomy"]
SizeChart = Literal["unisex", "womens"]


class SizeAdvice(BaseModel):
    """Returned by recommend_size: which size to buy, why, and whether it's in stock."""

    product_id: str
    name: str
    recommended_size: str
    reason: str = Field(description="One sentence on how the size was chosen, to pass on to the shopper.")
    fit_note: str = Field(description="How this kind of garment fits, from the size guide.")
    recommended_size_status: StockStatus
    recommended_size_quantity: int = Field(description="Units on hand in the recommended size.")
    available_sizes: list[str] = Field(description="Sizes with at least 1 unit in stock.")


class InStockAlternative(BaseModel):
    """Returned by similar_in_stock: a similar product that has the shopper's size."""

    product_id: str
    name: str
    garment_type: str
    why: str = Field(description="Why it's similar, e.g. 'Also Pierson College' or 'Another crewneck'.")


class AgentReply(BaseModel):
    """The agent's structured output for one chat turn."""

    reply: str = Field(
        description="What to say to the shopper, in the Campus Customs voice. Plain text, short."
    )
    product_ids: list[str] = Field(
        default_factory=list,
        description=(
            "product_id values (copied exactly from tool results), best match first. For a "
            f"browsing search (show_on_page=true): every matching product, up to {MAX_PAGE_RESULTS}. "
            f"Otherwise: the products the reply is about, up to {MAX_CHAT_CARDS}. Empty if none."
        ),
    )
    show_on_page: bool = Field(
        default=False,
        description=(
            "True when the shopper is browsing a type of item (e.g. 'what hoodies do you have', "
            "'show me Pierson gear'): the website then shows product_ids as product cards on the "
            "page. False for questions about one specific product (price, stock, details)."
        ),
    )
    results_title: str | None = Field(
        default=None,
        description="Short heading for the page results when show_on_page is true, e.g. 'Hoodies'.",
    )


class ProductCard(BaseModel):
    """A product the chat sends back. Built from the database, not written by the model."""

    product_id: str
    name: str
    price: float
    short_description: str
    image_url: str


class ChatReply(BaseModel):
    """What POST /api/chat sends back to the chat widget."""

    reply: str
    products: list[ProductCard] = Field(default_factory=list)
    show_on_page: bool = Field(
        default=False,
        description="True: show `products` as cards on the page. False: show them in the chat panel.",
    )
    results_title: str | None = None
    withheld: bool = Field(
        default=False,
        description=(
            "True when the agent's reply kept failing the safety or number checks (or the turn hit "
            "its usage limit), so a safe fallback message was sent instead. Not saved as history."
        ),
    )
    filtered: bool = Field(
        default=False,
        description=(
            "True when the model provider's content filter blocked the message. That turn is "
            "not saved or sent back as history, so it can't trip the filter again."
        ),
    )
    your_message: str | None = Field(
        default=None,
        description="The shopper's message as saved and sent to the agent, after privacy.redact().",
    )
    removed: list[str] = Field(
        default_factory=list,
        description="Kinds of sensitive detail taken out of the message, e.g. ['card number'].",
    )


class ChatHistoryMessage(BaseModel):
    """One saved message, as GET /api/chat/history returns it to reload the chat panel."""

    role: Literal["user", "assistant"]
    content: str
    products: list[ProductCard] = Field(default_factory=list)
    results_title: str | None = None
    created_at: str
