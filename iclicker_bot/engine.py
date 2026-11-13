"""Thread-safe monitor state machine and single-delivery browser commands."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import threading
import time
import uuid

from .solver import Solver

POLL_SECONDS = 3

DEFAULTS = {
    "provider": "codex", "model": "gpt-6.1-sol",
    "fallback_models": ["gpt-6.1-terra", "gpt-6-sol", "gpt-5.4"],
    "codex_path": "codex", "api_key": "", "discord_webhook": "", "solver_timeout": 90,
    "random_fallback": True, "random_wait_seconds": 12,
    "selectors": {key: "" for key in ("question", "questionId", "options", "textInput", "submit", "join", "active", "ended", "submitted")},
}


class Engine:
    def __init__(self, directory: Path, notify=None, solver_factory=Solver):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.config = deepcopy(DEFAULTS)
        self.config.update(self._load("config.json", {}))
        self.history = self._load("history.json", {})
        session = self._load("session.json", {})
        self.class_run = session.get("run_id") if session.get("active") else None
        self.events = []
        self.running = False
        self.status = "Paused"
        self.last_seen = 0
        self.started_at = 0
        self.snapshot = {}
        self.pending = None
        self.inflight = None
        self.generation = 0
        self.announced = set()
        self.joined = set()
        self.class_open = bool(self.class_run)
        self.alerted = set()
        self.loading_since = {}
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="question-solver")
        self.solver_factory = solver_factory
        self.solver = None
        self.notify = notify or (lambda message, pc=False: self.record("alert" if pc else "info", message))

    def _load(self, name, default):
        try:
            value = json.loads((self.directory / name).read_text(encoding="utf-8-sig"))
            if isinstance(default, dict) and not isinstance(value, dict):
                return default
            return value
        except (OSError, ValueError):
            return default

    def _save(self, name, data):
        target = self.directory / name
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        temporary.replace(target)

    def record(self, level, message):
        with self.lock:
            self.events.append({"time": datetime.now(timezone.utc).isoformat(), "level": level, "message": message})
            self.events = self.events[-250:]

    def alert_once(self, key, message):
        if key not in self.alerted:
            self.alerted.add(key)
            self.notify(message, pc=True)

    def settings(self):
        with self.lock:
            public = deepcopy(self.config)
            for secret in ("api_key", "discord_webhook"):
                public[secret + "_set"] = bool(public.pop(secret))
            return public

    def update_settings(self, data):
        with self.lock:
            if self.running:
                raise ValueError("Pause monitoring before changing Settings.")
            config = deepcopy(self.config)
            for key in DEFAULTS:
                if key in data:
                    # Empty secret inputs preserve saved credentials.
                    if key in ("api_key", "discord_webhook") and not data[key]:
                        continue
                    config[key] = data[key]
            if config["provider"] not in ("api", "codex"):
                raise ValueError("Choose Codex CLI or OpenAI API.")
            if not isinstance(config["model"], str) or not config["model"].strip():
                raise ValueError("A model is required.")
            if not isinstance(config["fallback_models"], list) or any(not isinstance(v, str) or not v.strip() for v in config["fallback_models"]):
                raise ValueError("Fallback models must be a list of model names.")
            if not isinstance(config["solver_timeout"], int) or not 15 <= config["solver_timeout"] <= 180:
                raise ValueError("Solver timeout must be 15–180 seconds.")
            if type(config["random_fallback"]) is not bool:
                raise ValueError("Random fallback must be enabled or disabled.")
            if type(config["random_wait_seconds"]) is not int or not 3 <= config["random_wait_seconds"] <= 45:
                raise ValueError("Random fallback wait must be 3-45 seconds.")
            if not isinstance(config["selectors"], dict) or set(config["selectors"]) != set(DEFAULTS["selectors"]) or any(not isinstance(v, str) for v in config["selectors"].values()):
                raise ValueError("Selectors must contain the documented selector fields.")
            webhook = config["discord_webhook"]
            if webhook:
                import re
                if not re.fullmatch(r"https://(?:discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_.-]+", webhook):
                    raise ValueError("Enter a valid Discord webhook URL.")
            if any(not isinstance(config[k], str) for k in ("codex_path", "api_key")):
                raise ValueError("Invalid credential or executable path.")
            self._save("config.json", config)
            self.config = config
            self.record("info", "Settings saved.")

    def start(self):
        with self.lock:
            if self.running:
                return
            if not self.config["discord_webhook"]:
                raise ValueError("Set the Discord webhook in Settings before starting.")
            self.generation += 1
            self.running = True
            self.started_at = time.monotonic()
            self.status = "Waiting for Edge extension"
            self.alerted.clear()
            self.solver = self.solver_factory(deepcopy(self.config), lambda message: self.record("info", message))
            self.record("info", f"Monitoring started. Checking the selected Edge tab every {POLL_SECONDS} seconds.")

    def stop(self):
        with self.lock:
            self.running = False
            self.generation += 1
            self.pending = None
            self.status = "Paused"
            self.record("info", "Monitoring paused.")

    def watchdog(self):
        with self.lock:
            if self.running and time.monotonic() - max(self.last_seen, self.started_at) > 20:
                self.status = "Edge connection lost"
                self.pending = None
                self.alert_once("connection", "Edge monitor is not connected. Open Edge and pair/arm the extension; check login and tab access.")

    def public_state(self):
        with self.lock:
            age = time.monotonic() - self.last_seen if self.last_seen else None
            bridge_connected = age is not None and age < 20
            return {"running": self.running, "status": self.status, "connected": bridge_connected and bool(self.snapshot),
                    "bridge_connected": bridge_connected,
                    "last_seen_seconds": round(age, 1) if age is not None else None,
                    "detection": {"state": self.snapshot.get("state", "not inspected"),
                                  "question_source": self.snapshot.get("questionSource", "absent"),
                                  "option_count": len(self.snapshot.get("options", [])),
                                  "submit_mode": self.snapshot.get("submitMode", "unclear"),
                                  "recovered_selectors": self.snapshot.get("recoveredSelectors", []),
                                  "network_detector": (self.snapshot.get("signals") or {}).get("network", "not inspected"),
                                  "wake_source": (self.snapshot.get("signals") or {}).get("wake", "timer"),
                                  "frame_probe": self.snapshot.get("frameProbe", "not inspected"),
                                  "frame": self.snapshot.get("frameId", 0),
                                  "join_visible": bool(self.snapshot.get("joinSelector"))},
                    "question": self.snapshot.get("question", ""), "events": list(self.events),
                    "settings": self.settings(), "poll_seconds": POLL_SECONDS}

    def work_state(self):
        with self.lock:
            return {"running":self.running, "solving":bool(self.inflight),
                    "ready":bool(self.pending and not self.pending.get("dispatched"))}

    def _remember(self, fingerprint, status):
        key = self._history_key(fingerprint)
        if self.history.get(key) == status:
            return
        self.history[key] = status
        self.history = dict(list(self.history.items())[-1000:])
        self._save("history.json", self.history)

    def _history_key(self, fingerprint):
        return f"{self.class_run}:{fingerprint}" if self.class_run else fingerprint

    def _history_status(self, fingerprint):
        return self.history.get(self._history_key(fingerprint), self.history.get(fingerprint))

    def poll(self, payload):
        with self.lock:
            self.last_seen = time.monotonic()
            self.alerted.discard("connection")
            result = payload.get("result")
            if result:
                self._result(result)
            if payload.get("error"):
                self.snapshot = {}
                self.pending = None
                self.status = "Browser needs attention" if self.running else "Paused"
                if self.running:
                    self.alert_once("browser:" + payload["error"], payload["error"])
                return {"command": None, "running": self.running, "selectors": self.config["selectors"]}
            snapshot = payload.get("snapshot", {})
            self.snapshot = snapshot
            if not self.running:
                return {"command": None, "running": False, "selectors": self.config["selectors"]}
            self._advance(snapshot)
            command = None
            if self.pending and not self.pending.get("dispatched") and not payload.get("acknowledgmentOnly"):
                if self.pending["fingerprint"] == snapshot.get("fingerprint"):
                    self.pending["dispatched"] = True
                    self.pending["sent_at"] = time.monotonic()
                    command = {k: v for k, v in self.pending.items() if k not in ("dispatched", "sent_at")}
                    if command["kind"] == "answer":
                        # Persist BEFORE sending. A crash or lost acknowledgment never causes a duplicate.
                        self._remember(command["fingerprint"], "dispatched")
                else:
                    self.pending = None
            if self.pending and self.pending.get("dispatched") and time.monotonic() - self.pending["sent_at"] > 20:
                self.alert_once("ack:" + self.pending["id"], "Browser action was not acknowledged. Check the tab; the action will not be repeated automatically.")
                self.pending = None
            return {"command": command, "running": True, "selectors": self.config["selectors"], "workPending":bool(self.inflight)}

    def _result(self, result):
        if not self.pending or result.get("id") != self.pending["id"]:
            return
        command = self.pending
        self.pending = None
        if result.get("ok"):
            if command["kind"] == "answer":
                self._remember(command["fingerprint"], "submitted")
                self.record("info", "Random fallback answer submitted and confirmed. You can change it while the poll is open." if command.get("random_fallback") else "Answer submitted and confirmed in the page.")
            else:
                self.record("info", "Joined the class.")
        else:
            self.alert_once("action:" + command["id"], result.get("message", "Browser action failed. Check the selected tab."))

    def _advance(self, snapshot):
        state = snapshot.get("state", "unknown")
        fingerprint = snapshot.get("fingerprint", "")
        signal = (snapshot.get("signals") or {}).get("lastEvent") or {}
        if signal.get("kind") == "question" and 8 <= signal.get("ageSeconds", -1) <= 45 and state in ("history", "idle", "waiting", "unknown"):
            self.alert_once("network:" + str(signal.get("key", "question")), "iClicker announced a new question, but its live question controls are not readable in the selected tab. Open the live course/poll page. No random choice is possible without clear answer controls.")
        if self.pending:
            if self.pending["fingerprint"] != fingerprint:
                self.pending = None
            else:
                return
        if state in ("login", "error", "unknown"):
            self.status = "Needs attention"
            self.alert_once("state:" + state, snapshot.get("problem") or "iClicker page is unrecognized; check login, access, and selector settings.")
            return
        for key in list(self.alerted):
            if key.startswith(("state:", "browser:")):
                self.alerted.discard(key)
        if state in ("history", "ended", "idle"):
            if state in ("ended", "idle"):
                if self.class_open:
                    self.generation += 1
                    self._save("session.json", {"active":False})
                self.class_open = False
                self.class_run = None
                self.announced.clear()
                self.joined.clear()
            self.status = {"history": "Poll history — waiting for a live class", "ended": "Class ended", "idle": "Waiting for class to start"}[state]
            return
        session = snapshot.get("sessionId") or "class"
        if not self.class_open:
            self.class_open = True
            self.class_run = str(uuid.uuid4())
            self._save("session.json", {"active":True,"run_id":self.class_run})
            self.alerted.clear()
            self.announced.add(session)
            self.notify("Class has started. Monitoring the selected iClicker tab.")
        if state == "join":
            self.status = "Joining class"
            if session not in self.joined:
                if not snapshot.get("joinSelector"):
                    self.alert_once("join:" + session, "Class is live, but the join control is unclear. Check the tab.")
                else:
                    self.joined.add(session)
                    self.pending = {"id": str(uuid.uuid4()), "kind": "join", "fingerprint": fingerprint}
            return
        if state == "waiting":
            self.status = "Joined — waiting for next question"
            return
        if state == "submitted":
            self.status = "Answer recorded — waiting for next question"
            if fingerprint:
                self._remember(fingerprint, "submitted")
            return
        if state != "question":
            return
        if not fingerprint:
            self.alert_once("fingerprint", "Question identity could not be verified; no answer will be submitted.")
            return
        if self._history_status(fingerprint) in ("dispatched", "submitted", "blocked"):
            self.status = "Question already handled - waiting"
            return
        if snapshot.get("contentLoading"):
            started = self.loading_since.setdefault(fingerprint, time.monotonic())
            remaining = snapshot.get("remainingSeconds")
            if time.monotonic() - started < 2 and not (isinstance(remaining, (int,float)) and remaining <= 3):
                self.status = "Waiting briefly for the question image to finish loading"
                return
        else:
            self.loading_since.pop(fingerprint, None)
        readable_image = snapshot.get("questionSource") == "visible_image" and bool(snapshot.get("questionImage", {}).get("source"))
        if (not snapshot.get("question", "").strip() and not readable_image) or snapshot.get("problem") or snapshot.get("captureProblem"):
            reason = snapshot.get("problem") or snapshot.get("captureProblem") or "The visible question text is absent."
            if self._queue_random(snapshot, reason):
                return
            self.status = "Question needs your help"
            self.alert_once("question:" + fingerprint, snapshot.get("problem") or "The visible question text is absent. Please provide it in the app chat; no answer was guessed.")
            return
        if not snapshot.get("controlsClear"):
            self.status = "Controls need your help"
            self.alert_once("controls:" + fingerprint, "Submission controls are unclear. Please inspect the tab and selector settings; no answer was entered.")
            return
        if not snapshot.get("screenshots"):
            self.status = "Waiting for complete question capture"
            return
        if self.inflight is not None:
            self.status = "Solving question"
            return
        self.status = "Solving question"
        generation = self.generation
        solver = self.solver
        self.inflight = fingerprint
        self.record("info", "New question captured. Starting a fresh solver with its text, options and figures.")
        future = self.pool.submit(solver.solve, deepcopy(snapshot))
        future.add_done_callback(lambda f: self._solved(f, fingerprint, generation))

    def _solved(self, future, fingerprint, generation):
        with self.lock:
            self.inflight = None
            if not self.running or generation != self.generation or self.snapshot.get("fingerprint") != fingerprint:
                return
            if self.snapshot.get("state") != "question":
                return
            if self._history_status(fingerprint) in ("dispatched", "submitted") or (self.pending and self.pending.get("random_fallback")):
                return
            try:
                answer = future.result()
            except Exception as error:
                # Solver exceptions are curated; unexpected exceptions never leak credential-bearing details.
                from .solver import SolverError
                message = str(error) if isinstance(error, SolverError) else "Question solver failed unexpectedly; no answer was submitted."
                if self._queue_random(self.snapshot, message):
                    return
                self._remember(fingerprint, "blocked")
                self.status = "Solver needs attention"
                self.alert_once("solver:" + fingerprint, message)
                return
            if answer["status"] != "answer":
                if self._queue_random(self.snapshot, "Solver needs help: " + answer["reason"]):
                    return
                self._remember(fingerprint, "blocked")
                self.status = "Question needs your help"
                self.alert_once("solver:" + fingerprint, "Solver needs help: " + answer["reason"])
                return
            self.record("info", f"Solver {answer.get('model', 'configured model')} returned an answer; rechecking the question before submission.")
            self.status = "Answer ready — verifying current question"
            self.pending = {"id": str(uuid.uuid4()), "kind": "answer", "fingerprint": fingerprint,
                            "answer": {k: answer[k] for k in ("option_ids", "text_answer")}}

    def _queue_random(self, snapshot, reason):
        fingerprint = snapshot.get("fingerprint")
        options = snapshot.get("options", [])
        if not self.config.get("random_fallback") or snapshot.get("state") != "question" or snapshot.get("inputKind") != "single" or not snapshot.get("controlsClear") or len(options) < 2 or not fingerprint:
            return False
        if self._history_status(fingerprint) in ("dispatched", "submitted"):
            return False
        option = secrets.choice(options)
        self.pending = {"id":str(uuid.uuid4()), "kind":"answer", "fingerprint":fingerprint,
                        "random_fallback":True, "answer":{"option_ids":[option["id"]], "text_answer":""}}
        self.status = "Random fallback ready - verifying the current poll"
        self.alert_once("random:" + fingerprint, f"{reason} Random fallback selected {option['text'][:200]} and will attempt submission. This is a random choice, not a solved answer. You can change it while the poll is open.")
        return True

    def retry_current(self):
        with self.lock:
            fingerprint = self.snapshot.get("fingerprint")
            if not fingerprint or self.pending or self.inflight:
                raise ValueError("No blocked question is ready for retry.")
            if self._history_status(fingerprint) == "dispatched":
                raise ValueError("Submission is uncertain. Verify the tab manually; automatic retry could duplicate it.")
            if self._history_status(fingerprint) == "submitted":
                raise ValueError("This question was already submitted.")
            self.history.pop(self._history_key(fingerprint), None)
            self.history.pop(fingerprint, None)
            self._save("history.json", self.history)
            self.alerted = {key for key in self.alerted if fingerprint not in key}
            self.record("info", "Current question will be inspected again on the next poll.")
