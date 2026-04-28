#!/usr/bin/env python3
"""Extract James/Marina dialogue from the Vegas script into browser data."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "m2m-files" / "M2M_Vegas_Full_Script.md"
TARGET = ROOT / "m2m-memorize" / "script-data.js"
SOURCE_TARGET = ROOT / "m2m-memorize" / "source-md.js"

DIALOGUE_RE = re.compile(r"^\*\*(James|Marina):\*\*\s*(.+?)\s*$")
HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")
ITALIC_RE = re.compile(r"^\*(.+?)\*\s*$")
INLINE_STAGE_RE = re.compile(r"\*\((.+?)\)\*")
LEADING_STAGE_RE = re.compile(r"^(\*\(.+?\)\*\s*)+")
MARKDOWN_RE = re.compile(r"[*_`]")
SPACE_RE = re.compile(r"\s+")


def clean_text(value: str) -> str:
    value = MARKDOWN_RE.sub("", value)
    value = SPACE_RE.sub(" ", value)
    return value.strip()


def clean_heading(value: str) -> str:
    value = clean_text(value)
    return value.strip("- ")


def extract_inline_cues(text: str) -> tuple[str, list[str], str]:
    cues = [clean_text(match) for match in INLINE_STAGE_RE.findall(text)]
    leading_match = LEADING_STAGE_RE.match(text)
    leading = leading_match.group(0).strip() if leading_match else ""
    cleaned = INLINE_STAGE_RE.sub("", text)
    return clean_text(cleaned), [cue for cue in cues if cue], leading


def is_flexible(section: str, beat: str, text: str) -> bool:
    flexible_markers = [
        "audience",
        "cold read",
        "object",
        "country",
        "akronym",
        "false ending",
        "name exchange",
        "question",
    ]
    joined = f"{section} {beat}".lower()
    return "[" in text or any(marker in joined for marker in flexible_markers)


def word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source script: {SOURCE}")

    section = "Opening"
    beat = "Opening"
    recent_stage: list[str] = []
    lines: list[dict[str, object]] = []
    seen: dict[str, int] = {}

    source_text = SOURCE.read_text(encoding="utf-8")

    for line_no, raw_line in enumerate(source_text.splitlines(), 1):
        line = raw_line.strip()
        if not line or line == "---":
            continue

        heading = HEADING_RE.match(line)
        if heading:
            title = clean_heading(heading.group(2))
            if heading.group(1) == "##":
                section = title
                beat = title
            else:
                beat = title
            recent_stage = [title]
            continue

        dialogue = DIALOGUE_RE.match(line)
        if dialogue:
            speaker = dialogue.group(1).lower()
            speaker_label = dialogue.group(1)
            text, inline_cues, leading_stage = extract_inline_cues(dialogue.group(2))
            if not text:
                recent_stage.extend(inline_cues)
                recent_stage = recent_stage[-3:]
                continue
            cue_bits = recent_stage[-2:] + inline_cues
            cue = " ".join(bit for bit in cue_bits if bit)
            key = f"{section}|{beat}|{speaker}|{text}"
            seen[key] = seen.get(key, 0) + 1
            lines.append(
                {
                    "id": f"m2m-{line_no:04d}-{speaker}",
                    "sourceLine": line_no,
                    "section": section,
                    "beat": beat,
                    "speaker": speaker,
                    "speakerLabel": speaker_label,
                    "text": text,
                    "linePrefix": f"**{speaker_label}:** {leading_stage + ' ' if leading_stage else ''}",
                    "rawLine": raw_line,
                    "cue": cue or beat or section,
                    "flexible": is_flexible(section, beat, text),
                    "words": word_count(text),
                }
            )
            recent_stage = []
            continue

        if line.startswith(">"):
            continue

        italic = ITALIC_RE.match(line)
        if italic:
            cue = clean_text(italic.group(1))
            if cue:
                recent_stage.append(cue)
                recent_stage = recent_stage[-3:]

    payload = {
        "title": "Mind2Mind Vegas",
        "source": "M2M_Vegas_Full_Script.md",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lineCount": len(lines),
        "lines": lines,
    }
    TARGET.write_text(
        "window.M2M_SCRIPT = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    SOURCE_TARGET.write_text(
        "window.M2M_SOURCE_MD = "
        + json.dumps(source_text, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(lines)} lines to {TARGET}")
    print(f"Wrote source markdown to {SOURCE_TARGET}")


if __name__ == "__main__":
    main()
