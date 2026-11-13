"""Run directly or through Check-App-Setup.cmd; never prints credentials."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from iclicker_bot.runtime import environment_report


def main():
    try:
        config = json.loads((ROOT / ".local" / "config.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        config = {}
    report = environment_report(config)
    print(f"Recommended releases checked {report['checked_on']}:")
    for name in ("python", "node", "codex", "edge"):
        value = report[name]
        print(f"  {name:8} installed={value['installed']}; recommended={value['recommended']} ({value['channel']})")
    print("\nRecommended channels: Node LTS, Python stable, Codex stable and Edge stable. Python has no separate LTS channel.")
    print("Run Install-App-Runtimes.cmd to install the pinned project-local Python, Node and Codex versions.")
    print("Update Edge through edge://settings/help. Use Codex login or configure an API key before solving.")
    if "gpt-6-astra" in config.get("fallback_models", []):
        print("ERROR: gpt-6-astra was reintroduced into saved fallbacks.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
