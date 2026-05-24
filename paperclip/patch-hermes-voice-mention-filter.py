#!/usr/bin/env python3
"""Patch hermes-agent so Telegram voice notes pass the mention filter.

In a group chat with ``require_mention: true``, hermes-agent's
``_handle_media_message`` filters by ``_should_process_message`` BEFORE
running STT. A voice note has empty ``text``/``caption`` at that point,
so the wake-word regex never matches and the message is silently dropped
even when the user spoke the wake word.

This script applies the same fix as upstream PR
https://github.com/NousResearch/hermes-agent/pull/31340 — eagerly
transcribe voice/audio messages BEFORE the mention filter, then run the
patterns against the transcript. Bypass paths (reply-to-bot,
free_response_chats, @mention, caption-match) skip the eager pass.

Idempotent: re-running on an already-patched file is a no-op (exit 0).
Runs after hermes-agent install in the Dockerfile.

Drop this script and its Dockerfile RUN step once the pinned
``HERMES_AGENT_REF`` includes upstream PR #31340.
"""

import pathlib
import sys

PATCH_MARKER = "_eager_transcribe_voice"

HELPER = '''
    async def _eager_transcribe_voice(self, msg) -> "str | None":
        """Download voice/audio and run STT eagerly. Used by `_handle_media_message`
        to evaluate mention patterns against the transcript BEFORE applying the
        `_should_process_message` filter -- the raw Telegram message has no
        ``text``/``caption`` for the filter to match a wake word against,
        which would otherwise silently drop every voice note in
        ``require_mention`` group chats.

        Returns the transcript text on success, or ``None`` on transcription
        failure / unsupported attachment / STT module unavailable.
        """
        try:
            from tools.transcription_tools import transcribe_audio
        except Exception as e:
            logger.debug("[%s] STT module unavailable: %s", self.name, e)
            return None
        try:
            if getattr(msg, "voice", None):
                file_obj = await msg.voice.get_file()
                ext = ".ogg"
            elif getattr(msg, "audio", None):
                file_obj = await msg.audio.get_file()
                ext = ".mp3"
            else:
                return None
            audio_bytes = await file_obj.download_as_bytearray()
            cached_path = cache_audio_from_bytes(bytes(audio_bytes), ext=ext)
            result = await asyncio.to_thread(transcribe_audio, cached_path)
            if isinstance(result, dict) and result.get("success"):
                return (result.get("text") or result.get("transcript") or "").strip() or None
        except Exception as e:
            logger.warning("[%s] Eager voice transcription failed: %s", self.name, e)
        return None

'''

ANCHOR = "    def _is_guest_mention(self, message: Message) -> bool:"

# Two candidate "head" patterns. Both anchor on the function definition + the
# first-line guard. We try the newer (v2026.5.16+) shape first, then fall back
# to the older shape. If neither matches, exit with a clear error.
HEAD_NEW = """    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        \"\"\"Handle incoming media messages, downloading images to local cache.\"\"\"
        if not update.message:
            return
        if not self._should_process_message(update.message):"""

HEAD_OLD = """    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        \"\"\"Handle incoming media messages, downloading images to local cache.\"\"\"
        if not update.message:
            return
        if not self._should_process_message(update.message):
            return

        msg = update.message"""

REPLACE_NEW = """    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        \"\"\"Handle incoming media messages, downloading images to local cache.\"\"\"
        if not update.message:
            return
        msg = update.message
        if (getattr(msg, "voice", None) or getattr(msg, "audio", None)) \\
                and self._is_group_chat(msg) and self._telegram_require_mention() \\
                and self._mention_patterns:
            chat_id_str = str(getattr(getattr(msg, "chat", None), "id", ""))
            voice_bypass = (
                self._is_reply_to_bot(msg)
                or self._is_guest_mention(msg)
                or chat_id_str in self._telegram_free_response_chats()
                or self._message_mentions_bot(msg)
                or self._message_matches_mention_patterns(msg)
            )
            if not voice_bypass:
                transcript = await self._eager_transcribe_voice(msg)
                if not transcript:
                    logger.info("[%s] Voice dropped: STT failed or empty transcript", self.name)
                    return
                matched_voice = False
                for pattern in self._mention_patterns:
                    if pattern.search(transcript):
                        matched_voice = True
                        break
                if not matched_voice:
                    logger.info("[%s] Voice dropped: no mention-pattern match in transcript %r", self.name, transcript[:80])
                    return
                logger.info("[%s] Voice accepted via transcript mention match: %r", self.name, transcript[:80])
        if not self._should_process_message(update.message):"""

REPLACE_OLD = """    async def _handle_media_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        \"\"\"Handle incoming media messages, downloading images to local cache.\"\"\"
        if not update.message:
            return
        msg = update.message
        if (getattr(msg, "voice", None) or getattr(msg, "audio", None)) \\
                and self._is_group_chat(msg) and self._telegram_require_mention() \\
                and self._mention_patterns:
            chat_id_str = str(getattr(getattr(msg, "chat", None), "id", ""))
            voice_bypass = (
                self._is_reply_to_bot(msg)
                or self._is_guest_mention(msg)
                or chat_id_str in self._telegram_free_response_chats()
                or self._message_mentions_bot(msg)
                or self._message_matches_mention_patterns(msg)
            )
            if not voice_bypass:
                transcript = await self._eager_transcribe_voice(msg)
                if not transcript:
                    logger.info("[%s] Voice dropped: STT failed or empty transcript", self.name)
                    return
                matched_voice = False
                for pattern in self._mention_patterns:
                    if pattern.search(transcript):
                        matched_voice = True
                        break
                if not matched_voice:
                    logger.info("[%s] Voice dropped: no mention-pattern match in transcript %r", self.name, transcript[:80])
                    return
                logger.info("[%s] Voice accepted via transcript mention match: %r", self.name, transcript[:80])
        if not self._should_process_message(msg):
            return"""


def main():
    target = pathlib.Path("/usr/local/lib/hermes-agent/gateway/platforms/telegram.py")
    if len(sys.argv) > 1:
        target = pathlib.Path(sys.argv[1])
    if not target.exists():
        print(f"[patch] target not found: {target} — skipping", file=sys.stderr)
        return 0

    src = target.read_text()
    if PATCH_MARKER in src:
        print(f"[patch] already applied to {target}")
        return 0

    if ANCHOR not in src:
        print(f"[patch] anchor `_is_guest_mention` not in {target} — refusing to patch", file=sys.stderr)
        return 2

    if HEAD_NEW in src:
        src = src.replace(HEAD_NEW, REPLACE_NEW, 1)
    elif HEAD_OLD in src:
        src = src.replace(HEAD_OLD, REPLACE_OLD, 1)
    else:
        print(f"[patch] neither old nor new `_handle_media_message` head matched in {target} — refusing to patch", file=sys.stderr)
        return 3

    src = src.replace(ANCHOR, HELPER + ANCHOR, 1)

    import ast
    try:
        ast.parse(src)
    except SyntaxError as e:
        print(f"[patch] post-patch syntax check failed: {e}", file=sys.stderr)
        return 4

    target.write_text(src)
    print(f"[patch] applied voice-mention-filter fix to {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
