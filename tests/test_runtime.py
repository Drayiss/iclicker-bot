import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from iclicker_bot.runtime import ROOT, codex_command, prepare_environment, runtime_lock
from tools.install_runtimes import digest, download, extract


class RuntimeTests(unittest.TestCase):
    def test_runtime_pins_are_consistent(self):
        lock=runtime_lock()
        self.assertEqual((ROOT/".nvmrc").read_text().strip(),lock["node"]["version"])
        self.assertEqual((ROOT/".python-version").read_text().strip(),lock["python"]["version"])
        package=json.loads((ROOT/"package.json").read_text())
        self.assertEqual(package["devDependencies"]["@openai/codex"],lock["codex"]["version"])
        self.assertEqual(package["version"],json.loads((ROOT/"extension/manifest.json").read_text())["version"])
        from iclicker_bot.engine import DEFAULTS
        self.assertNotIn('gpt-6-astra',DEFAULTS['fallback_models'])
        self.assertNotIn('gpt-6-astra',json.loads((ROOT/'config.example.json').read_text())['fallback_models'])
        for name in ("node","python"):
            self.assertRegex(lock[name]["sha256"],r"^[a-f0-9]{64}$")
        self.assertIn(lock["python"]["directory"],(ROOT/"Start-iClicker-Bot.cmd").read_text())

    def test_local_and_global_windows_npm_shims_resolve_without_a_shell(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for local in (True,False):
                shim=root/"node_modules"/".bin"/"codex.cmd" if local else root/"global"/"codex.cmd"
                entry=shim.parent.parent/"@openai"/"codex"/"bin"/"codex.js" if local else shim.parent/"node_modules"/"@openai"/"codex"/"bin"/"codex.js"
                entry.parent.mkdir(parents=True,exist_ok=True);entry.write_text("// fixture")
                with patch("shutil.which",side_effect=lambda name:str(shim) if name=="codex" else "node.exe"):
                    self.assertEqual(codex_command(),["node.exe",str(entry)])

    def test_local_runtime_precedes_global_path_without_duplicates(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/"runtime-lock.json").write_text(json.dumps(runtime_lock()))
            node=root/".local"/"runtimes"/runtime_lock()["node"]["directory"]
            node.mkdir(parents=True)
            with patch.dict(os.environ,{"PATH":"global-node"}):
                prepare_environment(root);prepare_environment(root)
                self.assertEqual(os.environ["PATH"].split(os.pathsep),[str(node),"global-node"])

    def test_checksum_mismatch_never_installs_archive(self):
        import io
        with tempfile.TemporaryDirectory() as temp:
            destination=Path(temp)/"runtime.zip"
            with patch("urllib.request.urlopen",return_value=io.BytesIO(b"wrong archive")):
                with self.assertRaisesRegex(ValueError,"checksum"):
                    download({"url":"https://example.test/runtime.zip","sha256":"0"*64,"version":"test","channel":"stable"},destination)
            self.assertFalse(destination.exists())

    def test_zip_paths_cannot_escape_runtime_directory(self):
        import zipfile
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=root/"bad.zip"
            with zipfile.ZipFile(archive,"w") as bundle:bundle.writestr("../escape.txt","bad")
            with self.assertRaises(ValueError):extract(archive,root/"target")
            self.assertFalse((root/"escape.txt").exists())


if __name__=="__main__":unittest.main()
