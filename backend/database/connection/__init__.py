import sqlite3
from pathlib import Path
from backend.config import DATABASE_PATH


def get_connection():
    path = Path(DATABASE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    with get_connection() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT DEFAULT 'default'
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                memory TEXT NOT NULL UNIQUE,
                source TEXT DEFAULT 'conversation',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        columns = {
            row["name"]
            for row in db.execute(
                "PRAGMA table_info(conversations)"
            ).fetchall()
        }

        if "session_id" not in columns:
            db.execute(
                "ALTER TABLE conversations "
                "ADD COLUMN session_id TEXT DEFAULT 'default'"
            )

        db.commit()


def save_conversation(message, response, session_id="default"):
    with get_connection() as db:
        cur = db.execute(
            """
            INSERT INTO conversations
            (message, response, session_id)
            VALUES (?, ?, ?)
            """,
            (message, response, session_id)
        )
        db.commit()
        return cur.lastrowid


def save_memory(memory):
    memory = str(memory).strip()
    if not memory:
        return

    with get_connection() as db:
        db.execute(
            "INSERT OR IGNORE INTO memories (memory) VALUES (?)",
            (memory,)
        )
        db.commit()


def get_memories(limit=30):
    with get_connection() as db:
        rows = db.execute(
            """
            SELECT id, memory, created_at, updated_at
            FROM memories
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()

    return [dict(row) for row in rows]


def search_memories(query, limit=30):
    with get_connection() as db:
        rows = db.execute(
            """
            SELECT id, memory, created_at, updated_at
            FROM memories
            WHERE memory LIKE ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (f"%{query}%", limit)
        ).fetchall()

    return [dict(row) for row in rows]
