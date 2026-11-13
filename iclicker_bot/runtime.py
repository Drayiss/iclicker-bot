"""Project-local runtime selection and credential-free diagnostics."""
from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def runtime_lock(root=ROOT):
    return json.loads((root / "runtime-lock.json").read_text(encoding="utf-8-sig"))


def prepare_environment(root=ROOT):
    lock = runtime_lock(root)
    candidates = [root / "node_modules" / ".bin", root / ".local" / "runtimes" / lock["node"]["directory"]]
    prefixes = [str(path) for path in candidates if path.is_dir()]
    if prefixes:
        existing = os.environ.get("PATH", "").split(os.pathsep)
        os.environ["PATH"] = os.pathsep.join(prefixes + [entry for entry in existing if entry not in prefixes])


def codex_command(configured="codex"):
    executable = shutil.which(configured)
    if not executable:
        raise FileNotFoundError("Codex CLI is not installed. Run Install-App-Runtimes.cmd, then sign in, or choose API mode.")
    args = [executable]
    if executable.lower().endswith((".cmd", ".bat")):
        directory = Path(executable).parent
        candidates = [directory / "node_modules" / "@openai" / "codex" / "bin" / "codex.js",
                      directory.parent / "@openai" / "codex" / "bin" / "codex.js"]
        entry = next((path for path in candidates if path.is_file()), None)
        node = shutil.which("node")
        if not entry or not node:
            raise FileNotFoundError("The Codex npm installation is incomplete. Run Install-App-Runtimes.cmd or set a native Codex executable path.")
        args = [node, str(entry)]
    return args


def version_of(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode == 0:
            return result.stdout.strip().splitlines()[0] if result.stdout.strip() else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "unavailable"


def environment_report(config=None, root=ROOT):
    prepare_environment(root)
    lock = runtime_lock(root)
    node = shutil.which("node")
    try:
        codex = codex_command((config or {}).get("codex_path", "codex"))
    except FileNotFoundError:
        codex = None
    edge = "unavailable"
    if os.name == "nt":
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, r"Software\Microsoft\Edge\BLBeacon") as key:
                    edge = winreg.QueryValueEx(key, "version")[0]
                    break
            except OSError:
                pass
    return {
        "checked_on": lock["checked_on"],
        "python": {"installed": platform.python_version(), "recommended": lock["python"]["version"], "channel": "stable"},
        "node": {"installed": version_of([node, "--version"]) if node else "unavailable", "recommended": lock["node"]["version"], "channel": "LTS"},
        "codex": {"installed": version_of(codex + ["--version"]) if codex else "unavailable", "recommended": lock["codex"]["version"], "channel": "stable"},
        "edge": {"installed": edge, "recommended": lock["edge"]["version"], "channel": "stable"},
    }
