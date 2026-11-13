"""Build a redistributable source archive, explicitly excluding local secrets."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "iClicker-Bot.zip"
OUTPUT.parent.mkdir(exist_ok=True)
files = [ROOT / name for name in ("app.py", "Start-iClicker-Bot.cmd", "Install-App-Runtimes.cmd", "Check-App-Setup.cmd", "runtime-lock.json", "package.json", ".nvmrc", ".python-version", "README.md", "DETECTION_NOTES.md", "config.example.json", ".gitignore")]
for directory in ("iclicker_bot", "extension", "web", "tests", "tools"):
    files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file() and "__pycache__" not in path.parts)
with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(ROOT).as_posix())
print(f"Created {OUTPUT.name} ({OUTPUT.stat().st_size:,} bytes); private settings excluded.")
