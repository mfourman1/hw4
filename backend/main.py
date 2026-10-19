"""Campus Customs backend: the FastAPI app for the shop website and its chat agent.

Run it from the backend/ folder:

    uvicorn main:app --reload --port 8000

Endpoints
    GET  /api/health                  quick check that the server is up
    GET  /api/products                every product, with a short description (Products page)
    GET  /api/products/{product_id}   one product, full text + stock by size (product page)
    GET  /api/products/{product_id}/alternatives?size=L   similar items in stock in that size
    GET  /api/groups                  header menus: colleges, sports, schools, family (merch_groups.py)
    GET  /images/products/<file>.jpg  product photos (the cleaned copy in data/products_clean/ if any)
    POST /api/auth/signup             create an account (row in the users table) and log in
    POST /api/auth/login              check email + password and log in (sets the session cookie)
    POST /api/auth/logout             end the session
    GET  /api/auth/me                 who is logged in (null for guests)
    POST /api/chat                    one chat message in, the agent's reply out (agent.py)
    GET  /api/chat/history            the logged-in shopper's saved chat (401 for guests)

    Wishlist, cart, and saved embroidery designs (logged in; guests keep these in the browser).
    Each call returns the whole ShopState.
    GET    /api/shop                       wishlist + cart + saved designs
    POST   /api/shop/merge                 add what the shopper collected as a guest
    POST   /api/wishlist                   add a product          DELETE /api/wishlist/{product_id}
    POST   /api/cart                       add a line             PATCH / DELETE /api/cart/{line_id}
    POST   /api/cart/group                 add a group order (one line per size, all or nothing)
    POST   /api/embroidery-designs         save a design          DELETE /api/embroidery-designs/{id}
    POST   /api/embroidery/check           is this embroidery text allowed? (anyone; safety rule 12)

    Shared wishlist links (guests and logged-in shoppers):
    POST   /api/wishlist/share             save a snapshot of a wishlist; returns its link
    GET    /api/wishlist/shared/{token}    the shared list, for family and friends to shop from

Types live in models.py; paths, database access, and the model connection live in tools.py;
wishlist, cart, and embroidery rules live in shop.py.
"""

import json
import logging
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles

import shop
from agent import run_chat
from catalogue_fixes import apply_catalogue_fixes
import audit
from merch_groups import group_menu, product_groups
from safety import ChatRateLimiter, embroidery_problem
from privacy import redact, scrub_saved_chats
from recommend import similar_in_size
from auth import (
    DUMMY_HASH,
    SESSION_DAYS,
    create_session,
    delete_session,
    hash_password,
    session_user,
    verify_password,
)
from models import (
    AlternativeProduct,
    CartAdd,
    CartUpdate,
    ChatDeps,
    ChatHistoryMessage,
    ChatReply,
    ChatRequest,
    Embroidery,
    EmbroideryCheck,
    EmbroideryCheckRequest,
    GroupOrder,
    LoginRequest,
    MenuGroup,
    ProductDetail,
    ProductSummary,
    SharedWishlist,
    ShopMerge,
    ShopState,
    SignupRequest,
    SizeStock,
    UserOut,
    WishlistAdd,
    WishlistShareCreate,
    WishlistShareLink,
)
from tools import (
    HISTORY_FOR_AGENT,
    PRODUCT_IMAGES_CLEAN_DIR,
    PRODUCT_IMAGES_DIR,
    MissingAPIKeyError,
    customer_info,
    ensure_schema,
    garment_categories,
    get_db,
    image_url,
    load_chat_history,
    normalize_size,
    resolve_page,
    save_chat_turn,
    saved_chat_messages,
    short_description,
    size_sort_key,
)

SESSION_COOKIE = "cc_session"
chat_limiter = ChatRateLimiter()  # safety rule 17: messages per shopper per minute and per day

log = logging.getLogger("campus_customs")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_schema()  # sessions, wishlist, cart, design tables + chat_messages.results_title
    for product_id in apply_catalogue_fixes():
        log.warning("Fixed catalogue descriptors for %s", product_id)
    if cleaned := scrub_saved_chats():
        log.warning("Removed sensitive details from %d saved chat messages", cleaned)
    yield


app = FastAPI(title="Campus Customs API", lifespan=lifespan)

class ProductPhotos(StaticFiles):
    """data/products/, except that a photo with a cleaned copy in data/products_clean/ (black
    side bars filled white by scripts/clean_photos.py) is served from there. Starlette tries
    the folders in order and never serves a file outside them."""

    def get_directories(self, directory=None, packages=None):
        return [PRODUCT_IMAGES_CLEAN_DIR, *super().get_directories(directory, packages)]


# Only the two product photo folders are public. Never mount all of data/, since it holds the
# database.
app.mount("/images/products", ProductPhotos(directory=PRODUCT_IMAGES_DIR), name="product-images")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# --- Products ---------------------------------------------------------------------------


def product_summary(r: sqlite3.Row) -> ProductSummary:
    return ProductSummary(
        product_id=r["product_id"],
        name=r["name"],
        garment_type=r["garment_type"],
        price=r["price"],
        short_description=short_description(r["description"]),
        image_url=image_url(r["image_file_path"]),
        categories=sorted(garment_categories(r["garment_type"], r["name"])),
        groups=product_groups(r["name"], r["description"]),
    )


@app.get("/api/products", response_model=list[ProductSummary])
def list_products() -> list[ProductSummary]:
    with get_db() as con:
        rows = con.execute(
            "SELECT product_id, name, garment_type, price, description, image_file_path "
            "FROM catalogue ORDER BY name"
        ).fetchall()
    return [product_summary(r) for r in rows]


@app.get("/api/products/{product_id}/alternatives", response_model=list[AlternativeProduct])
def product_alternatives(product_id: str, size: str | None = None, limit: int = 4) -> list[AlternativeProduct]:
    """Similar products (same group, then same kind of garment) in stock in `size`, for
    when the shopper's size has sold out (recommend.py)."""
    with get_db() as con:
        found = similar_in_size(
            con, product_id.strip().lower(), normalize_size(size) if size else None, max(1, min(limit, 8))
        )
    return [AlternativeProduct(**product_summary(row).model_dump(), why=why) for row, why in found]


@app.get("/api/groups", response_model=list[MenuGroup])
def list_groups() -> list[MenuGroup]:
    """The header's second-row menus, with only options that have products."""
    with get_db() as con:
        rows = con.execute("SELECT name, description FROM catalogue").fetchall()
    return group_menu(rows)


@app.get("/api/products/{product_id}", response_model=ProductDetail)
def get_product(product_id: str) -> ProductDetail:
    with get_db() as con:
        product = con.execute(
            "SELECT * FROM catalogue WHERE product_id = ?", (product_id,)
        ).fetchone()
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        stock = con.execute(
            "SELECT size, quantity FROM inventory WHERE product_id = ?", (product_id,)
        ).fetchall()

    sizes = sorted(
        (SizeStock(size=s["size"], quantity=s["quantity"]) for s in stock),
        key=lambda s: size_sort_key(s.size),
    )
    return ProductDetail(
        product_id=product["product_id"],
        name=product["name"],
        garment_type=product["garment_type"],
        price=product["price"],
        description=product["description"],
        colors=json.loads(product["colors"]),
        search_tags=json.loads(product["search_tags"]),
        image_url=image_url(product["image_file_path"]),
        sizes=sizes,
        total_in_stock=sum(s.quantity for s in sizes),
        embroidery_options=shop.embroidery_options(product),
        embroidery_price=shop.EMBROIDERY_PRICE,
        categories=sorted(garment_categories(product["garment_type"], product["name"])),
        groups=product_groups(product["name"], product["description"]),
        colorway=shop.colorway(product),
        color_options=shop.color_options(product),
        thread_colors=shop.THREAD_COLORS,
    )


# --- Accounts ---------------------------------------------------------------------------


def user_out(row: sqlite3.Row) -> UserOut:
    # first_name/last_name were added to the table later, so fall back to splitting `name`.
    first, _, last = row["name"].partition(" ")
    return UserOut(
        id=row["id"],
        first_name=row["first_name"] or first,
        last_name=row["last_name"] or last,
        email=row["email"],
    )


def start_session(response: Response, user_id: int) -> None:
    with get_db() as con:
        token = create_session(con, user_id)
    # HttpOnly: page scripts can't read it. SameSite=Lax: other sites can't send it with
    # their requests. (Add secure=True when the site is served over HTTPS.)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        path="/",
    )


def current_user(request: Request) -> sqlite3.Row | None:
    """The logged-in user for this request, from the session cookie, or None for a guest."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with get_db() as con:
        return session_user(con, token)


@app.post("/api/auth/signup", response_model=UserOut, status_code=201)
def signup(body: SignupRequest, response: Response) -> UserOut:
    # Fill every column the same way the seed users are filled: name is "First Last",
    # and created_at comes from the table's default.
    with get_db() as con:
        try:
            cur = con.execute(
                "INSERT INTO users (name, first_name, last_name, email, password_hash) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    f"{body.first_name} {body.last_name}",
                    body.first_name,
                    body.last_name,
                    body.email,
                    hash_password(body.password),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=409, detail="An account with that email already exists."
            ) from None
        row = con.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    start_session(response, row["id"])
    return user_out(row)


@app.post("/api/auth/login", response_model=UserOut)
def login(body: LoginRequest, response: Response) -> UserOut:
    with get_db() as con:
        row = con.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()

    # Same message (and same amount of hashing work) whether the email or the password is
    # wrong, so the login form can't be used to find out who has an account.
    stored = row["password_hash"] if row else DUMMY_HASH
    if not verify_password(body.password, stored) or row is None:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    start_session(response, row["id"])
    return user_out(row)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with get_db() as con:
            delete_session(con, token)
    response.delete_cookie(SESSION_COOKIE, path="/")


@app.get("/api/auth/me", response_model=UserOut | None)
def me(request: Request) -> UserOut | None:
    """Who is logged in, or null for a guest (not an error: guests are welcome)."""
    user = current_user(request)
    return user_out(user) if user else None


# --- Chat -------------------------------------------------------------------------------


@app.post("/api/chat", response_model=ChatReply)
async def chat(body: ChatRequest, request: Request) -> ChatReply:
    """Send one shopper message to the agent and return its reply + product cards.

    Logged in: the agent gets the shopper's name/email and their saved history, and the new
    turn is saved. Guest: the agent gets the history the browser sent, and nothing is saved.
    """
    user = current_user(request)
    shopper = f"user:{user['id']}" if user else "guest"
    # Safety rule 17: a logged-in shopper is limited by account; a guest by IP address (the
    # Vite dev proxy passes the browser's address in X-Forwarded-For).
    key = shopper if user else (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "unknown"))
    if limited := chat_limiter.check(key):
        audit.safety_event("rate_limit", "message refused (HTTP 429)", shopper=shopper)
        raise HTTPException(status_code=429, detail=limited)
    deps = ChatDeps(
        customer=customer_info(user) if user else None,
        page=resolve_page(body.page),
    )
    # Card numbers, passwords, and similar details are removed first, so they are never
    # sent to the model or saved (privacy.py).
    message = redact(body.message)
    if user:
        history = [(r["role"], r["content"]) for r in load_chat_history(user["id"], HISTORY_FOR_AGENT)]
    else:
        history = [(m.role, redact(m.content).text) for m in body.history]

    try:
        reply = await run_chat(
            message.text,
            deps,
            history,
            {"source": "web", "shopper": shopper, "message_chars": len(message.text), "redacted": message.removed},
        )
    except MissingAPIKeyError:
        log.error("Chat is unavailable: PORTKEY_API_KEY is not set.")
        raise HTTPException(
            status_code=503, detail="The shop assistant is unavailable right now."
        ) from None
    except Exception:
        # Model or network trouble. Log the details here; the shopper gets a short message.
        log.exception("Chat agent failed")
        raise HTTPException(
            status_code=502,
            detail="The shop assistant is having trouble right now. Please try again.",
        ) from None

    reply = reply.model_copy(update={"your_message": message.text, "removed": message.removed})
    # A turn the content filter blocked (or a withheld reply) isn't saved, so it can't trip the
    # filter again later or confuse the next turn.
    if user and not reply.filtered and not reply.withheld:
        save_chat_turn(user["id"], message.text, reply)
    return reply


@app.get("/api/chat/history", response_model=list[ChatHistoryMessage])
def chat_history(request: Request) -> list[ChatHistoryMessage]:
    """The logged-in shopper's saved conversation, oldest first. Guests have none."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to see your chat history.")
    return saved_chat_messages(user["id"])


# --- Wishlist, cart, and embroidery designs (logged-in shoppers) ------------------------


def require_user(request: Request) -> sqlite3.Row:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to save this to your account.")
    return user


def shop_change(request: Request, change) -> ShopState:
    """Run one wishlist/cart/design change for the logged-in shopper; return the new state."""
    user = require_user(request)
    try:
        change(user["id"])
    except shop.ShopError as err:
        raise HTTPException(status_code=400, detail=str(err)) from None
    return shop.get_shop_state(user["id"])


@app.get("/api/shop", response_model=ShopState)
def get_shop(request: Request) -> ShopState:
    return shop.get_shop_state(require_user(request)["id"])


@app.post("/api/shop/merge", response_model=ShopState)
def merge_shop(body: ShopMerge, request: Request) -> ShopState:
    def merge(user_id: int) -> None:
        for note in shop.merge_guest_state(user_id, body):
            log.info("Guest cart item not merged: %s", note)

    return shop_change(request, merge)


@app.post("/api/wishlist", response_model=ShopState)
def add_wishlist(body: WishlistAdd, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.add_to_wishlist(uid, body.product_id))


@app.delete("/api/wishlist/{product_id}", response_model=ShopState)
def remove_wishlist(product_id: str, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.remove_from_wishlist(uid, product_id))


@app.post("/api/cart", response_model=ShopState)
def add_cart(body: CartAdd, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.add_to_cart(uid, body))


@app.post("/api/cart/group", response_model=ShopState)
def add_group_order(body: GroupOrder, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.add_group_order(uid, body))


@app.patch("/api/cart/{line_id}", response_model=ShopState)
def update_cart(line_id: int, body: CartUpdate, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.update_cart_line(uid, line_id, body.quantity))


@app.delete("/api/cart/{line_id}", response_model=ShopState)
def remove_cart(line_id: int, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.remove_cart_line(uid, line_id))


@app.post("/api/embroidery-designs", response_model=ShopState)
def add_design(body: Embroidery, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.save_design(uid, body))


@app.post("/api/embroidery/check", response_model=EmbroideryCheck)
def check_embroidery(body: EmbroideryCheckRequest) -> EmbroideryCheck:
    """Safety rule 12, for the product page before it adds to the cart (guests' carts never
    reach the backend). Cart, design, and share routes check again through the Embroidery model."""
    text = " ".join(body.text.split())
    problem = embroidery_problem(text)
    if problem:
        audit.safety_event("embroidery", "text refused on the product page", chars=len(text))
    return EmbroideryCheck(ok=problem is None, problem=problem)


@app.delete("/api/embroidery-designs/{design_id}", response_model=ShopState)
def remove_design(design_id: int, request: Request) -> ShopState:
    return shop_change(request, lambda uid: shop.delete_design(uid, design_id))


# --- Shared wishlist links (anyone) ------------------------------------------------------


@app.post("/api/wishlist/share", response_model=WishlistShareLink, status_code=201)
def share_wishlist(body: WishlistShareCreate) -> WishlistShareLink:
    """Save a snapshot of a wishlist (with each item's size and embroidery) and return the
    link family and friends can shop from. Guests can share too: nothing is tied to an account."""
    try:
        token = shop.create_wishlist_share(body)
    except shop.ShopError as err:
        raise HTTPException(status_code=400, detail=str(err)) from None
    return WishlistShareLink(token=token, path=f"/wishlist/shared/{token}")


@app.get("/api/wishlist/shared/{token}", response_model=SharedWishlist)
def shared_wishlist(token: str) -> SharedWishlist:
    shared = shop.get_wishlist_share(token[:40])
    if shared is None:
        raise HTTPException(status_code=404, detail="This wishlist link isn't valid.")
    return shared
