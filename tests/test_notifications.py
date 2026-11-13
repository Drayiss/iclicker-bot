import io
import json
from unittest.mock import Mock, patch
import unittest
import urllib.error

from iclicker_bot.notifications import Notifier


class NotificationTests(unittest.TestCase):
    def worker(self, results):
        # Stop after one queued message; no real thread, PC dialog or HTTP request.
        notifier=Notifier.__new__(Notifier)
        notifier.webhook=lambda:"https://discord.com/api/webhooks/123/test"
        notifier.record=Mock()
        notifier.jobs=Mock()
        notifier.jobs.get.side_effect=[("Test message",False),StopIteration()]
        with patch("urllib.request.urlopen",side_effect=results) as request, patch("time.sleep"):
            with self.assertRaises(StopIteration):notifier._worker()
        return notifier,request

    def test_server_failure_is_retried(self):
        failure=urllib.error.HTTPError("https://discord.com",503,"Unavailable",{},io.BytesIO(b"{}"))
        notifier,request=self.worker([failure,io.BytesIO(b"")])
        self.assertEqual(request.call_count,2)
        notifier.record.assert_not_called()

    def test_malformed_rate_limit_payload_does_not_kill_delivery(self):
        failure=urllib.error.HTTPError("https://discord.com",429,"Limited",{},io.BytesIO(b"[]"))
        notifier,request=self.worker([failure,io.BytesIO(b"")])
        self.assertEqual(request.call_count,2)
        notifier.record.assert_not_called()

    def test_mentions_are_disabled_and_permanent_errors_are_not_retried(self):
        failure=urllib.error.HTTPError("https://discord.com",403,"Forbidden",{},io.BytesIO(b"{}"))
        notifier,request=self.worker([failure])
        self.assertEqual(request.call_count,1)
        payload=json.loads(request.call_args.args[0].data)
        self.assertEqual(payload["allowed_mentions"],{"parse":[]})
        notifier.record.assert_called_once()


if __name__=="__main__":unittest.main()
