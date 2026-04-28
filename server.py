#!/usr/bin/env python3
"""Local development server with Markdown write-back support."""

from __future__ import annotations

import json
import os
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
SCRIPT_PATH = ROOT / "m2m-files" / "M2M_Vegas_Full_Script.md"
EXTRACTOR = APP_DIR / "tools" / "extract_script_data.py"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/source-md":
            self._send_json({"markdown": SCRIPT_PATH.read_text(encoding="utf-8")})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/save-md":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            markdown = payload["markdown"]
            if not isinstance(markdown, str) or "# MIND2MIND" not in markdown[:200]:
                raise ValueError("Unexpected markdown payload")
            SCRIPT_PATH.write_text(markdown, encoding="utf-8")
            subprocess.run(["python3", str(EXTRACTOR)], cwd=str(APP_DIR), check=True)
            password = payload.get("password")
            if isinstance(password, str) and password:
                env = {**os.environ, "M2M_APP_PASSWORD": password}
                subprocess.run(
                    ["node", "tools/encrypt_payload.mjs"],
                    cwd=str(APP_DIR),
                    env=env,
                    check=True,
                )
            self._send_json({"ok": True, "message": "Markdown saved to source file"})
        except Exception as exc:  # pragma: no cover - dev server guardrail
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(exc)}).encode("utf-8"))

    def _send_json(self, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    print("Serving Mind2Mind Memorize on http://localhost:4173/")
    server.serve_forever()


if __name__ == "__main__":
    main()
