"""Install hash-verified official runtimes inside this project only."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from iclicker_bot.runtime import prepare_environment, runtime_lock, version_of


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(component, destination):
    if destination.exists() and digest(destination) == component["sha256"]:
        return destination
    partial = destination.with_suffix(".partial")
    print(f"Downloading official {component['channel']} release {component['version']}...", flush=True)
    with urllib.request.urlopen(component["url"], timeout=30) as response, partial.open("wb") as output:
        shutil.copyfileobj(response, output)
    if digest(partial) != component["sha256"]:
        raise ValueError("Downloaded archive checksum does not match the official release; nothing was installed.")
    partial.replace(destination)
    return destination


def extract(archive, target):
    root = target.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (target / member.filename).resolve().is_relative_to(root):
                raise ValueError("Archive contains a path outside its runtime directory.")
        bundle.extractall(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-codex", action="store_true", help="Install Python and Node only (API mode)")
    args = parser.parse_args()
    lock = runtime_lock()
    runtime_root = ROOT / ".local" / "runtimes"
    downloads = ROOT / ".local" / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    runtime_root.mkdir(parents=True, exist_ok=True)
    try:
        component = lock["python"]
        directory = runtime_root / component["directory"]
        python = directory / "python.exe"
        if not python.is_file() or version_of([str(python), "--version"]) != "Python " + component["version"]:
            extract(download(component, downloads / "python.zip"), directory)
        # The embedded interpreter needs an explicit import path. UTF-8 without
        # a BOM supports spaces/non-ASCII paths and avoids breaking stdlib loading.
        stem = "python" + "".join(component["version"].split(".")[:2])
        (directory / (stem + "._pth")).write_text(f"{stem}.zip\n.\n{ROOT}\n", encoding="utf-8")
        if version_of([str(python), "--version"]) != "Python " + component["version"]:
            raise RuntimeError("Installed Python version did not match runtime-lock.json.")
        (directory / ".ready").write_text(component["version"], encoding="utf-8")

        component = lock["node"]
        directory = runtime_root / component["directory"]
        node = directory / "node.exe"
        if not node.is_file() or version_of([str(node), "--version"]) != "v" + component["version"]:
            extract(download(component, downloads / "node.zip"), runtime_root)
        if version_of([str(node), "--version"]) != "v" + component["version"]:
            raise RuntimeError("Installed Node version did not match runtime-lock.json.")
        (directory / ".ready").write_text(component["version"], encoding="utf-8")
        prepare_environment()
        if not args.skip_codex:
            print(f"Installing pinned stable Codex CLI {lock['codex']['version']}...", flush=True)
            npm = directory / "node_modules" / "npm" / "bin" / "npm-cli.js"
            subprocess.run([str(node), str(npm), "install", "--prefix", str(ROOT), "--cache", str(ROOT / ".local" / "npm-cache"),
                            "--no-audit", "--no-fund", "--fetch-retries=0", "--fetch-timeout=15000"], check=True, cwd=ROOT)
            package = ROOT / "node_modules" / "@openai" / "codex" / "package.json"
            if json.loads(package.read_text(encoding="utf-8"))["version"] != lock["codex"]["version"]:
                raise RuntimeError("Installed Codex version did not match runtime-lock.json.")
        print("Project-local runtime setup complete. Run Check-App-Setup.cmd to inspect versions.")
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, zipfile.BadZipFile):
        print("Runtime setup could not finish. Check access to python.org, nodejs.org and registry.npmjs.org, then rerun Install-App-Runtimes.cmd. A checksum mismatch also stops installation.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
