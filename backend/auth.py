"""Password hashing and login sessions for Campus Customs accounts.

Stored format (same as the seed users in data/campus_customs.db):

    pbkdf2_sha256$<salt>$<hash>

- <salt> is a random string made at signup (16 hex characters), used as UTF-8 bytes.
- <hash> is PBKDF2-HMAC-SHA256(password, salt, 120,000 iterations), written as hex.

Signup and login both go through _pbkdf2() below, so they always use the same settings.
If the algorithm, salt handling, or iteration count ever differed, the right password
would stop matching.
"""

import hashlib
import hmac
import secrets
import sqlite3

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 120_000
SALT_BYTES = 8  # 8 random bytes -> 16 hex characters, like the seed users


def _pbkdf2(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), ITERATIONS
    ).hex()


def hash_password(password: str) -> str:
    """Make the stored string for a new account, with a fresh random salt."""
    salt = secrets.token_hex(SALT_BYTES)
    return f"{ALGORITHM}${salt}${_pbkdf2(password, salt)}"


def verify_password(password: str, stored: str) -> bool:
    """Check a typed password against a stored string.

    The stored hash is never "un-hashed" (that isn't possible). Instead, read the salt out
    of the stored string, hash the typed password with that same salt, and compare the two
    hashes in constant time so the comparison doesn't leak how many characters matched.
    """
    try:
        algorithm, salt, expected = stored.split("$")
    except ValueError:
        return False
    if algorithm != ALGORITHM:
        return False
    return hmac.compare_digest(_pbkdf2(password, salt), expected)


# Used when a login email doesn't exist, so that path takes as long as a wrong password
# and response time doesn't reveal which emails have accounts.
DUMMY_HASH = hash_password(secrets.token_hex(16))


# --- Login sessions ---------------------------------------------------------------------
# Logging in creates a random session token. The browser keeps it in an HttpOnly cookie
# (page scripts can't read it); the sessions table keeps only its SHA-256 hash, so a copy of
# the database can't be used to log in as anyone. The server looks up the cookie on every
# request to know who is chatting, rather than trusting a user id sent by the browser.

SESSION_DAYS = 30


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(con: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    con.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) "
        "VALUES (?, ?, datetime('now', ?))",
        (_token_hash(token), user_id, f"+{SESSION_DAYS} days"),
    )
    return token


def session_user(con: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """The user a session token belongs to, or None if it's unknown or expired."""
    return con.execute(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')",
        (_token_hash(token),),
    ).fetchone()


def delete_session(con: sqlite3.Connection, token: str) -> None:
    con.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
