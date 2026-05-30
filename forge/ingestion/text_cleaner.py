"""Text normalization for uploaded corpus files."""

from __future__ import annotations

import csv
import json
import re
from email import policy
from email.parser import Parser
from pathlib import Path


def clean_text_file(path: str | Path) -> str:
    file_path = Path(path)
    suffix = file_path.suffix.lower()

    if suffix == ".eml":
        message = Parser(policy=policy.default).parsestr(file_path.read_text(encoding="utf-8", errors="ignore"))
        payload = message.get_body(preferencelist=("plain",))
        text = payload.get_content() if payload else message.get_content()
    elif suffix == ".json":
        data = json.loads(file_path.read_text(encoding="utf-8", errors="ignore"))
        text = json.dumps(data, ensure_ascii=True, indent=2)
    elif suffix == ".csv":
        with file_path.open("r", encoding="utf-8", errors="ignore", newline="") as handle:
            rows = csv.reader(handle)
            text = "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)
    else:
        text = file_path.read_text(encoding="utf-8", errors="ignore")

    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
