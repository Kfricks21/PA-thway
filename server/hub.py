"""PA-thway — Student Hub.

A shared board for one class cohort: notes, comment threads, likes, challenge
questions, a derived leaderboard, a member list, notifications and reports.

Mounted as a Flask blueprint on the server this repo already deploys, so the Hub
needs no second vendor and no second URL.

Storage
-------
Postgres when DATABASE_URL is set (Render → New → Postgres, then add the
connection string as an environment variable on the web service). SQLite
otherwise, at HUB_DB or ./hub.db.

Use Postgres for anything real. Render's free web-service disk is ephemeral: with
SQLite your class's notes disappear on the next deploy or restart. SQLite is here
so `flask run` works on your laptop with zero setup.

Identity
--------
No passwords, by design. Each browser mints a random device key on first launch
and the student picks a display name; anyone holding the cohort code is in. The
key travels in the X-Device-Key header and is what "your own post" means for
edits and deletes.

Be clear-eyed about what that is: the cohort code is the only gate, and a device
key is a claim rather than proof. Good enough for a study board among classmates.
Not private, and not a place for patient data or graded work.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, g, jsonify, request

hub = Blueprint("hub", __name__, url_prefix="/api/hub")

DATABASE_URL = os.getenv("DATABASE_URL", "")
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
SQLITE_PATH = os.getenv("HUB_DB", "hub.db")

# Guardrails sized for a cohort of ~90, not for the open internet.
MAX_BODY = 20000
MAX_TITLE = 200
MAX_COMMENT = 2000
MAX_NOTES_PER_PAGE = 200
RATE_WINDOW_S = 60
RATE_MAX_WRITES = 40

_rate: dict[str, list[float]] = {}


# --------------------------------------------------------------------- storage

def _connect():
    if IS_PG:
        import psycopg
        from psycopg.rows import dict_row

        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return psycopg.connect(url, row_factory=dict_row, autocommit=True)

    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma journal_mode=WAL")
    conn.execute("pragma foreign_keys=ON")
    return conn


def db():
    if "hub_db" not in g:
        g.hub_db = _connect()
    return g.hub_db


@hub.teardown_app_request
def _close_db(exc):
    conn = g.pop("hub_db", None)
    if conn is not None:
        conn.close()


def q(sql: str) -> str:
    """SQLite uses ?, Postgres uses %s. Author once in ? and translate."""
    return sql.replace("?", "%s") if IS_PG else sql


def rows(sql, args=()):
    cur = db().cursor()
    cur.execute(q(sql), args)
    out = [dict(r) for r in cur.fetchall()]
    cur.close()
    return out


def one(sql, args=()):
    r = rows(sql, args)
    return r[0] if r else None


def run(sql, args=()):
    cur = db().cursor()
    cur.execute(q(sql), args)
    cur.close()
    if not IS_PG:
        db().commit()


SCHEMA = [
    """create table if not exists cohorts (
        code text primary key,
        name text default '',
        owner_key text not null,
        created_at text not null
    )""",
    """create table if not exists members (
        cohort text not null,
        device_key text not null,
        name text not null default 'Anonymous',
        emoji text default '',
        year text default '',
        last_seen text not null,
        primary key (cohort, device_key)
    )""",
    """create table if not exists notes (
        id text primary key,
        cohort text not null,
        author_key text not null,
        author_name text not null default 'Anonymous',
        title text not null,
        course text default 'General',
        body text not null default '',
        file text default '',
        questions text default '[]',
        hidden integer not null default 0,
        edited_at text,
        created_at text not null
    )""",
    """create table if not exists comments (
        id text primary key,
        cohort text not null,
        note_id text not null,
        author_key text not null,
        author_name text not null default 'Anonymous',
        body text not null,
        hidden integer not null default 0,
        created_at text not null
    )""",
    """create table if not exists likes (
        cohort text not null,
        target_id text not null,
        target_kind text not null default 'note',
        member_key text not null,
        created_at text not null,
        primary key (target_id, member_key)
    )""",
    """create table if not exists challenges (
        id text primary key,
        cohort text not null,
        from_key text not null,
        from_name text not null default 'Anonymous',
        from_emoji text default '',
        to_key text not null,
        to_name text not null default '',
        block text default '',
        question text default '{}',
        stake text default '',
        message text default '',
        status text not null default 'sent',
        correct integer,
        reply_emoji text default '',
        reply_message text default '',
        note_id text,
        answered_at text,
        created_at text not null
    )""",
    """create table if not exists scores (
        id text primary key,
        cohort text not null,
        member_key text not null,
        member_name text not null default 'Anonymous',
        label text default 'Quiz',
        score integer not null default 0,
        total integer not null default 0,
        created_at text not null
    )""",
    """create table if not exists notifs (
        id text primary key,
        cohort text not null,
        member_key text not null,
        kind text not null,
        actor_name text default '',
        actor_emoji text default '',
        note_id text,
        body text default '',
        read integer not null default 0,
        created_at text not null
    )""",
    """create table if not exists reports (
        id text primary key,
        cohort text not null,
        target_id text not null,
        target_kind text not null default 'note',
        reporter_key text not null,
        reason text default '',
        created_at text not null
    )""",
    "create index if not exists notes_cohort_time on notes (cohort, created_at desc)",
    "create index if not exists comments_note on comments (note_id, created_at)",
    "create index if not exists likes_cohort on likes (cohort)",
    "create index if not exists ch_cohort_time on challenges (cohort, created_at desc)",
    "create index if not exists scores_cohort on scores (cohort, member_key)",
    "create index if not exists notifs_member on notifs (cohort, member_key)",
]


def init_db(app=None):
    """Create tables. Called once at import time by register_hub()."""
    conn = _connect()
    try:
        cur = conn.cursor()
        for stmt in SCHEMA:
            cur.execute(stmt)
        cur.close()
        if not IS_PG:
            conn.commit()
    finally:
        conn.close()


# ----------------------------------------------------------------- primitives

def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return uuid.uuid4().hex


def me() -> str:
    return (request.headers.get("X-Device-Key") or "").strip()[:64]


def clean(value, limit: int) -> str:
    return re.sub(r"\s+\Z", "", str(value or ""))[:limit]


def norm_code(code) -> str:
    return re.sub(r"[^A-Z0-9-]", "", str(code or "").upper())[:24]


def body() -> dict:
    return request.get_json(silent=True) or {}


def need_key(fn):
    """Every write is attributed. No key, no write."""

    @wraps(fn)
    def wrapper(*a, **kw):
        if not me():
            return jsonify({"error": "Missing X-Device-Key."}), 400
        stamps = _rate.setdefault(me(), [])
        cutoff = time.time() - RATE_WINDOW_S
        stamps[:] = [t for t in stamps if t > cutoff]
        if len(stamps) >= RATE_MAX_WRITES:
            return jsonify({"error": "Slow down a moment — too many posts at once."}), 429
        stamps.append(time.time())
        return fn(*a, **kw)

    return wrapper


def is_owner(code: str) -> bool:
    c = one("select owner_key from cohorts where code = ?", (code,))
    return bool(c and c["owner_key"] == me())


def jparse(raw, fallback):
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(raw or "null") or fallback
    except (ValueError, TypeError):
        return fallback


def initials(name: str) -> str:
    parts = [w for w in re.split(r"\s+", (name or "").strip()) if w]
    if not parts:
        return "PA"
    return "".join(w[0] for w in parts)[:2].upper()


# --------------------------------------------------------------------- shaping

def snapshot(code: str) -> dict:
    cohort = one("select * from cohorts where code = ?", (code,))
    if not cohort:
        return {}

    members = rows("select * from members where cohort = ? order by name", (code,))
    notes = rows(
        "select * from notes where cohort = ? and hidden = 0 order by created_at desc limit ?",
        (code, MAX_NOTES_PER_PAGE),
    )
    comments = rows(
        "select * from comments where cohort = ? and hidden = 0 order by created_at", (code,)
    )
    likes = rows("select * from likes where cohort = ?", (code,))
    challenges = rows(
        "select * from challenges where cohort = ? order by created_at desc limit 200", (code,)
    )
    scores = rows("select * from scores where cohort = ?", (code,))
    notifs = rows(
        "select * from notifs where cohort = ? and member_key = ? order by created_at desc limit 60",
        (code, me()),
    )

    mine = me()

    def like_count(target_id):
        ls = [l for l in likes if l["target_id"] == target_id]
        return len(ls), any(l["member_key"] == mine for l in ls)

    def shape_comment(c):
        n, liked = like_count(c["id"])
        return {
            "id": c["id"], "authorKey": c["author_key"], "author": c["author_name"],
            "initials": initials(c["author_name"]), "text": c["body"],
            "ts": c["created_at"], "likes": n, "likedByMe": liked,
            "mine": c["author_key"] == mine,
        }

    def shape_note(nt):
        n, liked = like_count(nt["id"])
        return {
            "id": nt["id"], "authorKey": nt["author_key"], "author": nt["author_name"],
            "initials": initials(nt["author_name"]), "title": nt["title"],
            "course": nt["course"], "body": nt["body"], "file": nt["file"] or "",
            "questions": jparse(nt["questions"], []),
            "ts": nt["created_at"], "edited": bool(nt["edited_at"]),
            "likes": n, "likedByMe": liked, "mine": nt["author_key"] == mine,
            "comments": [shape_comment(c) for c in comments if c["note_id"] == nt["id"]],
        }

    # Points are derived on read, never stored: 10 a correct answer, 25 a duel won.
    board = []
    for m in members:
        mkey = m["device_key"]
        ms = [s for s in scores if s["member_key"] == mkey]
        correct = sum(s["score"] or 0 for s in ms)
        answered = sum(s["total"] or 0 for s in ms)
        won = len([
            c for c in challenges
            if c["to_key"] == mkey and c["status"] == "answered" and c["correct"]
        ])
        board.append({
            "key": mkey, "name": m["name"], "emoji": m["emoji"] or "",
            "initials": initials(m["name"]), "points": correct * 10 + won * 25,
            "correct": correct, "answered": answered, "duelsWon": won,
            "isMe": mkey == mine,
        })
    board.sort(key=lambda r: (-r["points"], r["name"].lower()))

    return {
        "code": code,
        "ownerKey": cohort["owner_key"],
        "isOwner": cohort["owner_key"] == mine,
        "me": mine,
        "notes": [shape_note(n) for n in notes],
        "members": [{
            "key": m["device_key"], "name": m["name"], "emoji": m["emoji"] or "",
            "initials": initials(m["name"]), "year": m["year"] or "",
            "lastSeen": m["last_seen"], "isMe": m["device_key"] == mine,
        } for m in members],
        "board": board,
        "challenges": [{
            "id": c["id"], "fromKey": c["from_key"], "from": c["from_name"],
            "fromEmoji": c["from_emoji"] or "", "toKey": c["to_key"], "to": c["to_name"],
            "block": c["block"] or "", "question": jparse(c["question"], {}),
            "stake": c["stake"] or "", "message": c["message"] or "",
            "status": c["status"], "correct": c["correct"],
            "replyEmoji": c["reply_emoji"] or "", "replyMessage": c["reply_message"] or "",
            "ts": c["created_at"],
            "incoming": c["to_key"] == mine, "outgoing": c["from_key"] == mine,
        } for c in challenges],
        "notifs": [{
            "id": n["id"], "kind": n["kind"], "actor": n["actor_name"],
            "actorEmoji": n["actor_emoji"] or "", "noteId": n["note_id"],
            "body": n["body"] or "", "read": bool(n["read"]), "ts": n["created_at"],
        } for n in notifs],
    }


def notify(code, member_key, kind, actor, actor_emoji="", note_id=None, text=""):
    if not member_key or member_key == me():
        return
    run(
        """insert into notifs (id, cohort, member_key, kind, actor_name, actor_emoji,
                               note_id, body, read, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
        (uid(), code, member_key, kind, actor, actor_emoji, note_id, clean(text, 200), now()),
    )


# ---------------------------------------------------------------------- routes

@hub.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "storage": "postgres" if IS_PG else "sqlite",
        "durable": IS_PG,
        "note": None if IS_PG else "SQLite on an ephemeral disk — set DATABASE_URL for real use.",
    })


@hub.post("/join")
@need_key
def join():
    d = body()
    code = norm_code(d.get("code"))
    if len(code) < 4:
        return jsonify({"error": "That code is too short."}), 400

    profile = d.get("profile") or {}
    name = clean(profile.get("name"), 60) or "Anonymous"

    cohort = one("select * from cohorts where code = ?", (code,))
    if not cohort:
        run(
            "insert into cohorts (code, name, owner_key, created_at) values (?, ?, ?, ?)",
            (code, clean(profile.get("klass"), 40), me(), now()),
        )
        cohort = one("select * from cohorts where code = ?", (code,))

    existing = one(
        "select device_key from members where cohort = ? and device_key = ?", (code, me())
    )
    args = (name, clean(profile.get("emoji"), 8), clean(profile.get("year"), 20), now())
    if existing:
        run(
            "update members set name = ?, emoji = ?, year = ?, last_seen = ? "
            "where cohort = ? and device_key = ?",
            args + (code, me()),
        )
    else:
        run(
            "insert into members (cohort, device_key, name, emoji, year, last_seen) "
            "values (?, ?, ?, ?, ?, ?)",
            (code, me(), *args),
        )

    return jsonify(snapshot(code))


@hub.get("/snapshot/<code>")
def get_snapshot(code):
    code = norm_code(code)
    data = snapshot(code)
    if not data:
        return jsonify({"error": "No cohort found for " + code + "."}), 404
    if me():
        run(
            "update members set last_seen = ? where cohort = ? and device_key = ?",
            (now(), code, me()),
        )
    return jsonify(data)


@hub.post("/<code>/notes")
@need_key
def post_note(code):
    code = norm_code(code)
    d = body()
    title = clean(d.get("title"), MAX_TITLE)
    text = clean(d.get("body"), MAX_BODY)
    if not title or not text:
        return jsonify({"error": "A note needs a title and a body."}), 400

    note_id = uid()
    run(
        """insert into notes (id, cohort, author_key, author_name, title, course, body,
                              file, questions, hidden, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
        (note_id, code, me(), clean(d.get("author"), 60) or "Anonymous", title,
         clean(d.get("course"), 60) or "General", text, clean(d.get("file"), 200),
         json.dumps(d.get("questions") or []), now()),
    )

    author = clean(d.get("author"), 60) or "Anonymous"
    for m in rows("select device_key from members where cohort = ?", (code,)):
        notify(code, m["device_key"], "note", author, clean(d.get("emoji"), 8), note_id, title)

    return jsonify(snapshot(code))


@hub.patch("/<code>/notes/<note_id>")
@need_key
def edit_note(code, note_id):
    code = norm_code(code)
    note = one("select * from notes where id = ?", (note_id,))
    if not note:
        return jsonify({"error": "That note is gone."}), 404
    if note["author_key"] != me():
        return jsonify({"error": "You can only edit your own notes."}), 403

    d = body()
    run(
        "update notes set title = ?, body = ?, course = ?, edited_at = ? where id = ?",
        (clean(d.get("title"), MAX_TITLE) or note["title"],
         clean(d.get("body"), MAX_BODY) or note["body"],
         clean(d.get("course"), 60) or note["course"], now(), note_id),
    )
    return jsonify(snapshot(code))


@hub.delete("/<code>/notes/<note_id>")
@need_key
def delete_note(code, note_id):
    code = norm_code(code)
    note = one("select * from notes where id = ?", (note_id,))
    if not note:
        return jsonify(snapshot(code))
    if note["author_key"] != me() and not is_owner(code):
        return jsonify({"error": "Only the author or the cohort owner can remove this."}), 403

    run("delete from likes where target_id = ?", (note_id,))
    run("delete from comments where note_id = ?", (note_id,))
    run("delete from notes where id = ?", (note_id,))
    return jsonify(snapshot(code))


@hub.post("/<code>/notes/<note_id>/comments")
@need_key
def post_comment(code, note_id):
    code = norm_code(code)
    d = body()
    text = clean(d.get("text"), MAX_COMMENT)
    if not text:
        return jsonify({"error": "Write something first."}), 400

    note = one("select * from notes where id = ?", (note_id,))
    if not note:
        return jsonify({"error": "That note is gone."}), 404

    author = clean(d.get("author"), 60) or "Anonymous"
    run(
        """insert into comments (id, cohort, note_id, author_key, author_name, body,
                                 hidden, created_at)
           values (?, ?, ?, ?, ?, ?, 0, ?)""",
        (uid(), code, note_id, me(), author, text, now()),
    )

    notify(code, note["author_key"], "comment", author, clean(d.get("emoji"), 8), note_id, text)
    # Anyone already in the thread hears about a reply too.
    for c in rows("select distinct author_key from comments where note_id = ?", (note_id,)):
        if c["author_key"] != note["author_key"]:
            notify(code, c["author_key"], "reply", author, clean(d.get("emoji"), 8), note_id, text)

    return jsonify(snapshot(code))


@hub.delete("/<code>/comments/<comment_id>")
@need_key
def delete_comment(code, comment_id):
    code = norm_code(code)
    c = one("select * from comments where id = ?", (comment_id,))
    if c and c["author_key"] != me() and not is_owner(code):
        return jsonify({"error": "Only the author or the cohort owner can remove this."}), 403
    run("delete from likes where target_id = ?", (comment_id,))
    run("delete from comments where id = ?", (comment_id,))
    return jsonify(snapshot(code))


@hub.post("/<code>/like")
@need_key
def like(code):
    code = norm_code(code)
    d = body()
    target = clean(d.get("targetId"), 64)
    kind = "comment" if d.get("kind") == "comment" else "note"
    if not target:
        return jsonify({"error": "Nothing to like."}), 400

    existing = one(
        "select * from likes where target_id = ? and member_key = ?", (target, me())
    )
    if existing:
        run("delete from likes where target_id = ? and member_key = ?", (target, me()))
    else:
        run(
            "insert into likes (cohort, target_id, target_kind, member_key, created_at) "
            "values (?, ?, ?, ?, ?)",
            (code, target, kind, me(), now()),
        )
        table = "comments" if kind == "comment" else "notes"
        row = one(f"select author_key from {table} where id = ?", (target,))
        if row:
            notify(code, row["author_key"], "like", clean(d.get("actor"), 60) or "Someone",
                   clean(d.get("emoji"), 8), target if kind == "note" else None)

    return jsonify(snapshot(code))


@hub.post("/<code>/challenges")
@need_key
def send_challenge(code):
    code = norm_code(code)
    d = body()
    to_key = clean(d.get("toKey"), 64)
    if not to_key:
        return jsonify({"error": "Pick who you are challenging."}), 400

    sender = clean(d.get("from"), 60) or "Anonymous"
    run(
        """insert into challenges (id, cohort, from_key, from_name, from_emoji, to_key,
                                   to_name, block, question, stake, message, status,
                                   note_id, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)""",
        (uid(), code, me(), sender, clean(d.get("fromEmoji"), 8), to_key,
         clean(d.get("to"), 60), clean(d.get("block"), 60),
         json.dumps(d.get("question") or {}), clean(d.get("stake"), 200),
         clean(d.get("message"), 200), clean(d.get("noteId"), 64) or None, now()),
    )
    notify(code, to_key, "challenge", sender, clean(d.get("fromEmoji"), 8),
           None, clean(d.get("message"), 200))
    return jsonify(snapshot(code))


@hub.patch("/<code>/challenges/<challenge_id>")
@need_key
def answer_challenge(code, challenge_id):
    code = norm_code(code)
    ch = one("select * from challenges where id = ?", (challenge_id,))
    if not ch:
        return jsonify({"error": "That challenge is gone."}), 404
    if ch["to_key"] != me():
        return jsonify({"error": "That challenge was not sent to you."}), 403

    d = body()
    run(
        """update challenges set status = 'answered', correct = ?, reply_emoji = ?,
                                 reply_message = ?, answered_at = ? where id = ?""",
        (1 if d.get("correct") else 0, clean(d.get("emoji"), 8),
         clean(d.get("message"), 200), now(), challenge_id),
    )
    notify(code, ch["from_key"], "answered", clean(d.get("author"), 60) or "Your classmate",
           clean(d.get("emoji"), 8), None, clean(d.get("message"), 200))
    return jsonify(snapshot(code))


@hub.post("/<code>/scores")
@need_key
def record_score(code):
    code = norm_code(code)
    d = body()
    run(
        """insert into scores (id, cohort, member_key, member_name, label, score, total, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)""",
        (uid(), code, me(), clean(d.get("name"), 60) or "Anonymous",
         clean(d.get("label"), 60) or "Quiz", int(d.get("score") or 0),
         int(d.get("total") or 0), now()),
    )
    return jsonify({"ok": True})


@hub.post("/<code>/report")
@need_key
def report(code):
    code = norm_code(code)
    d = body()
    run(
        """insert into reports (id, cohort, target_id, target_kind, reporter_key, reason, created_at)
           values (?, ?, ?, ?, ?, ?, ?)""",
        (uid(), code, clean(d.get("targetId"), 64),
         "comment" if d.get("kind") == "comment" else "note", me(),
         clean(d.get("reason"), 300), now()),
    )
    owner = one("select owner_key from cohorts where code = ?", (code,))
    if owner:
        notify(code, owner["owner_key"], "report", "A classmate", "", None,
               clean(d.get("reason"), 200))
    return jsonify({"ok": True})


@hub.post("/<code>/hide")
@need_key
def hide(code):
    """Cohort owner moderation: take a post out of the feed without deleting it."""
    code = norm_code(code)
    if not is_owner(code):
        return jsonify({"error": "Only the cohort owner can hide posts."}), 403
    d = body()
    table = "comments" if d.get("kind") == "comment" else "notes"
    run(f"update {table} set hidden = 1 where id = ?", (clean(d.get("targetId"), 64),))
    return jsonify(snapshot(code))


@hub.post("/<code>/read")
@need_key
def mark_read(code):
    code = norm_code(code)
    run(
        "update notifs set read = 1 where cohort = ? and member_key = ?", (norm_code(code), me())
    )
    return jsonify({"ok": True})


# -------------------------------------------------------------------- mounting

def register_hub(app):
    """Call this from server/app.py after `app = Flask(__name__)`:

        from hub import register_hub
        register_hub(app)
    """
    init_db(app)
    app.register_blueprint(hub)
    return app
