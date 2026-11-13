"""Deduplicated PC + Discord notifications; never log webhook credentials."""
import ctypes
import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request


class Notifier:
    def __init__(self, webhook, record):
        self.webhook = webhook
        self.record = record
        self.jobs = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def send(self, message, pc=False):
        self.record("alert" if pc else "info", message)
        self.jobs.put((message, pc))

    def _worker(self):
        while True:
            message, pc = self.jobs.get()
            if pc and os.name == "nt":
                threading.Thread(target=ctypes.windll.user32.MessageBoxW,
                    args=(0, message, "iClicker Bot needs attention", 0x40 | 0x1000), daemon=True).start()
            webhook = self.webhook()
            if not webhook:
                self.record("alert", "Discord is not configured; the alert is shown on this PC only.")
                continue
            for attempt in range(3):
                request = urllib.request.Request(webhook, data=json.dumps({
                    "content": "iClicker Bot: " + message[:1800], "allowed_mentions": {"parse": []}
                }).encode(), headers={"Content-Type": "application/json", "User-Agent": "iClickerBot/1.0"})
                try:
                    with urllib.request.urlopen(request, timeout=10):
                        pass
                    break
                except urllib.error.HTTPError as error:
                    if error.code == 429 and attempt < 2:
                        try:
                            details = json.load(error)
                            delay = min(30, max(1, float(details.get("retry_after", 2) if isinstance(details, dict) else 2)))
                        except (ValueError, TypeError):
                            delay = 2
                        time.sleep(delay)
                        continue
                    if error.code >= 500 and attempt < 2:
                        time.sleep(attempt + 1)
                        continue
                    self.record("alert", f"Discord delivery failed (HTTP {error.code}). Check the webhook in Settings.")
                    break
                except (OSError, TimeoutError):
                    if attempt < 2:
                        time.sleep(attempt + 1)
                    else:
                        self.record("alert", "Discord delivery failed: network unavailable.")
