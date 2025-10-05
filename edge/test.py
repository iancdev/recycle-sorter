"""Edge test harness for publishing mock classifications."""

import random
from datetime import datetime, timezone

from main import (
    CATEGORY_ID_TO_SLUG,
    _get_active_session_id as _resolve_active_session_id,
    publish_classification,
)

_CATEGORY_IDS = sorted(CATEGORY_ID_TO_SLUG.keys())
_RAW_PAYLOAD_SOURCE = "edge-test-script"


def _ensure_active_session():
    """Verify there is an active session before publishing events."""

    session_id = _resolve_active_session_id()
    if not session_id:
        print(
            "[Test] No active session detected. Start a session in the dashboard before pushing events."
        )
        return None

    print(f"[Test] Active session detected: {session_id}")
    return session_id


def _publish_mock_classification(sequence_number):
    category_id = random.choice(_CATEGORY_IDS)
    category_slug = CATEGORY_ID_TO_SLUG.get(category_id, "garbage")
    raw_payload = {
        "recognized_category_id": category_id,
        "source": _RAW_PAYLOAD_SOURCE,
        "mock_sequence": sequence_number,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    published = publish_classification(
        category_slug=category_slug,
        confidence=None,
        raw_payload=raw_payload,
    )

    if published:
        print(
            f"[Test] Published mock classification #{sequence_number} "
            f"(category: {category_slug}, id: {category_id})"
        )
    else:
        print("[Test] Failed to publish; check Supabase credentials and session state.")

    return published


def main():
    print(
        "Press Enter to publish a mock classification. Type 'q' and press Enter, or use Ctrl+C, to exit."
    )
    _ensure_active_session()

    sequence_number = 1
    try:
        while True:
            try:
                user_input = input("\nPress Enter to send mock classification (q to quit): ")
            except EOFError:
                print("\n[Test] EOF received; exiting.")
                break

            if user_input.strip().lower() in {"q", "quit", "exit"}:
                print("[Test] Exit requested; stopping.")
                break

            _publish_mock_classification(sequence_number)
            sequence_number += 1
    except KeyboardInterrupt:
        print("\n[Test] Interrupted; shutting down.")


if __name__ == "__main__":
    main()
