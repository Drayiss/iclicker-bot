import json
from pathlib import Path
import tempfile
import http.client
import io
import unittest

from app import make_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = make_server(Path(cls.temp.name), port=0)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.server_close(); cls.server.engine.pool.shutdown()
        cls.temp.cleanup()

    def request(self, path, payload=None, authenticated=True, headers=None):
        request_headers = {"Content-Type": "application/json", "Host": f"127.0.0.1:{self.server.server_port}", "Connection": "close"}
        if authenticated: request_headers["Authorization"] = f"Bearer {self.server.token}"
        request_headers.update(headers or {})
        body = json.dumps(payload).encode() if payload is not None else b""
        return self.raw_request(path, body, request_headers, "POST" if payload is not None else "GET")

    def raw_request(self, path, body, headers, method="POST"):
        headers["Content-Length"] = str(len(body))
        lines = [f"{method} {path} HTTP/1.1", *[f"{key}: {value}" for key, value in headers.items()], "", ""]
        connection = MemorySocket("\r\n".join(lines).encode() + body)
        self.server.RequestHandlerClass(connection, ("127.0.0.1", 12345), self.server)
        response = http.client.HTTPResponse(MemorySocket(connection.output.getvalue()))
        response.begin()
        return response

    def test_panel_and_demo_are_available(self):
        with self.request("/") as response:
            html = response.read().decode()
            self.assertIn(self.server.token, html)
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
        with self.request("/demo") as response: self.assertEqual(response.status, 200)

    def test_state_requires_auth(self):
        with self.request("/api/state", authenticated=False) as response: self.assertEqual(response.status, 401)

    def test_settings_form_requires_auth(self):
        with self.request("/api/settings-form", authenticated=False) as response:
            self.assertEqual(response.status, 401)

    def test_settings_form_returns_saved_webhook_but_no_api_key(self):
        webhook = "https://discord.com/api/webhooks/123/test"
        with self.request("/api/settings", {"api_key": "TEST_SECRET", "discord_webhook": webhook}): pass
        with self.request("/api/settings-form", headers={"Sec-Fetch-Site": "same-origin"}) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {"discord_webhook": webhook})
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_settings_form_rejects_cross_origin_and_extension_reads(self):
        for headers in ({"Origin": "chrome-extension://test"}, {"Origin": "https://attacker.example"}, {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}):
            with self.subTest(headers=headers), self.request("/api/settings-form", headers=headers) as response:
                self.assertEqual(response.status, 403)
                self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
                self.assertNotIn("https://discord.com/api/webhooks", response.read().decode())

    def test_webhook_is_loaded_from_disk_after_restart(self):
        webhook = "https://discord.com/api/webhooks/456/restart-test"
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "config.json").write_text(json.dumps({"discord_webhook": webhook}), encoding="utf-8")
            original = self.server
            self.server = make_server(Path(directory), port=0)
            try:
                with self.request("/api/settings-form") as response:
                    self.assertEqual(json.loads(response.read()), {"discord_webhook": webhook})
            finally:
                self.server.server_close()
                self.server.engine.pool.shutdown()
                self.server = original

    def test_settings_and_poll_require_auth(self):
        for path in ("/api/settings", "/api/poll", "/api/start"):
            with self.request(path, {}, authenticated=False) as response: self.assertEqual(response.status, 401)

    def test_host_rebinding_rejected(self):
        with self.request("/", headers={"Host": "attacker.example"}) as response: self.assertEqual(response.status, 403)

    def test_credentials_not_in_state(self):
        with self.request("/api/settings", {"api_key": "TEST_SECRET", "discord_webhook": "https://discord.com/api/webhooks/123/test"}): pass
        with self.request("/api/state") as response:
            text = response.read().decode()
            self.assertNotIn("TEST_SECRET", text)
            self.assertNotIn("https://discord.com/api/webhooks", text)

    def test_browser_extension_cors(self):
        with self.request("/api/poll", {"snapshot": {"state": "idle"}}, headers={"Origin": "chrome-extension://test"}) as response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "chrome-extension://test")
        with self.request("/api/state", headers={"Origin": "https://attacker.example"}) as response:
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_other_extensions_cannot_read_panel_pairing_code_through_cors(self):
        with self.request("/",authenticated=False,headers={"Origin":"chrome-extension://another-extension"}) as response:
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_work_status_requires_auth_and_never_dispatches_an_action(self):
        with self.request("/api/work",authenticated=False) as response:self.assertEqual(response.status,401)
        with self.request("/api/work") as response:
            status=json.loads(response.read())
            self.assertEqual(set(status),{"running","solving","ready"})

    def test_invalid_payload_returns_400_without_echoing_secrets(self):
        with self.raw_request("/api/settings", b'{"api_key":"SECRET', {"Host":f"127.0.0.1:{self.server.server_port}", "Authorization":f"Bearer {self.server.token}", "Connection":"close"}) as response:
            self.assertEqual(response.status, 400)
            self.assertNotIn("SECRET", response.read().decode())


class MemorySocket:
    """Exercise the real HTTP parser/handler without restricted loopback sockets."""
    def __init__(self, data):
        self.input = io.BytesIO(data)
        self.output = io.BytesIO()

    def makefile(self, *_): return self.input
    def sendall(self, data): self.output.write(data)


if __name__ == "__main__": unittest.main()
