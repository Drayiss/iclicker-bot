"""Run with Python 3.11+. No third-party Python packages are required."""
from __future__ import annotations

import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import sys
import threading
import time
import webbrowser

from iclicker_bot.engine import Engine
from iclicker_bot.notifications import Notifier
from iclicker_bot.runtime import prepare_environment, runtime_lock

ROOT = Path(__file__).resolve().parent


def make_server(directory=None, port=8765):
    directory = Path(directory or ROOT / ".local")
    engine = Engine(directory)
    notifier = Notifier(lambda: engine.config["discord_webhook"], engine.record)
    engine.notify = notifier.send
    token_path = directory / "pairing-token"
    if not token_path.exists():
        token_path.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    token = token_path.read_text(encoding="utf-8").strip()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never print request bodies, credentials or repeated polls.

        def valid_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def cors(self):
            origin = self.headers.get("Origin", "")
            # The pairing token is embedded in the local panel. Other installed
            # extensions must not be able to fetch that HTML to discover it.
            if self.path.startswith("/api/") and self.path != "/api/settings-form" and origin.startswith("chrome-extension://"):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def send(self, status, data, content_type="application/json"):
            body = json.dumps(data).encode() if content_type == "application/json" else data.encode()
            self.send_response(status)
            self.cors()
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
            return self.valid_host() and hmac.compare_digest(supplied.encode(), token.encode())

        def do_OPTIONS(self):
            if not self.valid_host():
                return self.send(403, {"error": "Invalid host"})
            self.send(200, {})

        def do_GET(self):
            if not self.valid_host():
                return self.send(403, {"error": "Invalid host"})
            if self.path == "/":
                # A navigation can display the panel but cross-origin scripts cannot read its token.
                html = (ROOT / "web" / "index.html").read_text(encoding="utf-8").replace("__PAIRING_TOKEN__", token)
                return self.send(200, html, "text/html")
            if self.path in ("/dashboard.js", "/style.css", "/demo.js"):
                path = ROOT / "web" / self.path.lstrip("/")
                return self.send(200, path.read_text(encoding="utf-8"), "text/javascript" if path.suffix == ".js" else "text/css")
            if self.path == "/demo":
                return self.send(200, (ROOT / "web" / "demo.html").read_text(encoding="utf-8"), "text/html")
            if self.path == "/api/settings-form":
                if not self.authorized():
                    return self.send(401, {"error": "Unauthorized"})
                # Only the local settings panel needs the saved webhook. Keep it
                # out of regular state/extension responses and cross-origin reads.
                origin = self.headers.get("Origin", "")
                site = self.headers.get("Sec-Fetch-Site", "")
                if origin not in ("", f"http://127.0.0.1:{self.server.server_port}") or site not in ("", "none", "same-origin"):
                    return self.send(403, {"error": "Local settings panel only"})
                with engine.lock:
                    settings = {"discord_webhook": engine.config["discord_webhook"]}
                return self.send(200, settings)
            if self.path == "/api/state":
                if not self.authorized():
                    return self.send(401, {"error": "Unauthorized"})
                return self.send(200, engine.public_state())
            if self.path == "/api/work":
                if not self.authorized():
                    return self.send(401, {"error": "Unauthorized"})
                return self.send(200, engine.work_state())
            return self.send(404, {"error": "Not found"})

        def do_POST(self):
            if not self.authorized():
                return self.send(401, {"error": "Unauthorized"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 18_000_000:
                    return self.send(413, {"error": "Invalid or oversized request"})
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Expected a JSON object.")
                if self.path == "/api/poll":
                    if "snapshot" in data and not isinstance(data["snapshot"], dict):
                        raise ValueError("Expected a question snapshot.")
                    return self.send(200, engine.poll(data))
                if self.path == "/api/start":
                    engine.start()
                elif self.path == "/api/stop":
                    engine.stop()
                elif self.path == "/api/settings":
                    engine.update_settings(data)
                elif self.path == "/api/retry":
                    engine.retry_current()
                elif self.path == "/api/test-alert":
                    notifier.send("Test alert from the PC application.", pc=True)
                else:
                    return self.send(404, {"error": "Not found"})
                return self.send(200, engine.public_state())
            except (ValueError, KeyError, TypeError):
                # Validation messages are hand-authored; JSON parser errors can echo secret values.
                import sys
                error = sys.exception()
                message = str(error) if type(error) is ValueError else "Invalid request data."
                return self.send(400, {"error": message})
            except Exception:
                engine.record("alert", "An internal request failed. Check local file access and restart the app.")
                return self.send(500, {"error": "Local request failed; no browser action was authorized."})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    server.engine = engine
    server.token = token
    return server


def main():
    if sys.version_info < (3, 11):
        print("Python 3.11+ is required. Run Install-App-Runtimes.cmd for the recommended release.")
        return 1
    prepare_environment()
    recommended = runtime_lock()["python"]["version"]
    installed = ".".join(map(str, sys.version_info[:3]))
    if installed != recommended:
        print(f"Python {installed} is compatible; recommended Python is {recommended}. Run Install-App-Runtimes.cmd to update this project.")
    parser = argparse.ArgumentParser(description="Experimental iClicker PC monitor")
    parser.add_argument("--no-open", action="store_true", help="Do not open the control panel automatically")
    args = parser.parse_args()
    try:
        server = make_server()
    except OSError:
        print("Could not start on port 8765. The app may already be running. Open http://127.0.0.1:8765")
        return 1
    print("iClicker Bot is running: http://127.0.0.1:8765\nKeep this window open. Press Ctrl+C to close.")
    def watchdog():
        while True:
            time.sleep(2)
            server.engine.watchdog()
    threading.Thread(target=watchdog, daemon=True).start()
    if not args.no_open:
        webbrowser.open("http://127.0.0.1:8765")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.engine.stop()
        server.server_close()
        server.engine.pool.shutdown(wait=False, cancel_futures=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
