"""CMD-friendly bootstrap; never changes system Python, Node or script policies."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from iclicker_bot.runtime import prepare_environment, runtime_lock


def main():
    prepare_environment()
    lock = runtime_lock()
    local = ROOT / ".local" / "runtimes" / lock["python"]["directory"] / "python.exe"
    python = str(local) if local.is_file() and local.with_name(".ready").exists() else sys.executable
    args = sys.argv[1:]
    if "--install" in args:
        target = ROOT / "tools" / "install_runtimes.py"
        args.remove("--install")
    elif "--check" in args:
        target = ROOT / "tools" / "check_environment.py"
        args.remove("--check")
    else:
        target = ROOT / "app.py"
    try:
        return subprocess.call([python, str(target), *args], cwd=ROOT)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
