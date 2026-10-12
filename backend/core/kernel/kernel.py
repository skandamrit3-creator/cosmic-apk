from backend.ai.gateway.gateway import AIGateway
from backend.database.connection import (
    save_conversation,
    get_connection,
    save_memory,
    get_memories,
)
from backend.security.verification.verifier import verify_response

gateway = AIGateway()


def get_recent_history(limit=10, session_id="default"):
    with get_connection() as db:
        rows = db.execute(
            """
            SELECT message, response
            FROM conversations
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit)
        ).fetchall()

    rows.reverse()

    history = []

    for row in rows:
        history.append({
            "role": "user",
            "content": row["message"]
        })
        history.append({
            "role": "model",
            "content": row["response"]
        })

    return history


def get_memory_context():
    memories = get_memories(30)

    if not memories:
        return ""

    return "\n".join(
        f"- {item['memory']}"
        for item in memories
    )


def extract_memory(message):
    text = message.strip()
    lower = text.lower()

    triggers = (
        "remember that ",
        "remember this ",
        "my name is ",
        "i prefer ",
        "i like ",
        "i don't like ",
        "i want you to remember ",
        "from now on ",
    )

    for trigger in triggers:
        if lower.startswith(trigger):
            memory = text[len(trigger):].strip(" .")
            if memory:
                save_memory(memory)
            break


def process_message(message, session_id="default"):
    history = get_recent_history(10, session_id)
    memory_context = get_memory_context()

    enriched_message = message

    if memory_context:
        enriched_message = (
            "Persistent COSMIC memory:\n"
            + memory_context
            + "\n\nCurrent user message:\n"
            + message
        )

    result = gateway.chat(
        enriched_message,
        history=history
    )

    if not result.get("success"):
        return result

    response = result["message"]
    verified = verify_response(response)

    save_conversation(message, response, session_id)
    extract_memory(message)

    return {
        "success": True,
        "type": "response",
        "provider": result.get("provider"),
        "model": result.get("model"),
        "message": response,
        "verified": verified,
        "session_id": session_id
    }
