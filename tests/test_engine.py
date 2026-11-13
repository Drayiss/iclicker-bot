import copy
from concurrent.futures import Future
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from iclicker_bot.engine import Engine
from iclicker_bot.solver import SolverError


def question(key="q1", **changes):
    result = {"state": "question", "fingerprint": key, "sessionId": "session1",
              "questionId": key, "question": "What is 2 + 2?", "inputKind": "single",
              "options": [{"id": "option-1", "text": "4"}, {"id": "option-2", "text": "5"}],
              "controlsClear": True, "screenshots": ["fake-image"], "problem": ""}
    result.update(changes)
    return result


class ManualPool:
    def __init__(self):
        self.calls = []
        self.future = None

    def submit(self, function, *args):
        self.calls.append((function, args))
        self.future = Future()
        return self.future


ANSWER = {"status": "answer", "option_ids": ["option-1"], "text_answer": "", "reason": "Arithmetic", "model": "test"}


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.alerts = []
        self.engine = Engine(Path(self.directory.name), lambda message, pc=False: self.alerts.append((message, pc)))
        self.engine.pool.shutdown()
        self.engine.pool = ManualPool()
        self.engine.update_settings({"discord_webhook": "https://discord.com/api/webhooks/123/test", "random_fallback":False})
        self.engine.start()

    def tearDown(self):
        self.directory.cleanup()

    def poll(self, snapshot, **extra):
        return self.engine.poll({"snapshot": snapshot, **extra})

    def solve(self):
        self.poll(question())
        self.engine.pool.future.set_result(copy.deepcopy(ANSWER))

    def test_idle_is_quiet(self):
        for _ in range(10):
            self.poll({"state": "idle", "fingerprint": "idle"})
        self.assertEqual(self.alerts, [])
        self.assertEqual(self.engine.pool.calls, [])

    def test_history_is_not_live(self):
        self.poll({"state": "history", "fingerprint": "history"})
        self.assertEqual(self.alerts, [])
        self.assertFalse(self.engine.pending)

    def test_class_alert_and_join_only_once(self):
        snapshot = {"state": "join", "sessionId": "s", "fingerprint": "join", "joinSelector": "button"}
        command = self.poll(snapshot)["command"]
        self.assertEqual(command["kind"], "join")
        self.assertIsNone(self.poll(snapshot)["command"])
        self.poll({"state": "waiting", "sessionId": "s", "fingerprint": "wait"}, result={"id": command["id"], "ok": True})
        self.poll(snapshot)
        self.assertEqual(len(self.alerts), 1)

    def test_missing_question_never_calls_solver_and_alerts_once(self):
        snapshot = question(question="")
        for _ in range(5): self.poll(snapshot)
        self.assertEqual(self.engine.pool.calls, [])
        self.assertEqual(len([a for a in self.alerts if a[1]]), 1)

    def test_unclear_controls_never_call_solver(self):
        self.poll(question(controlsClear=False))
        self.assertEqual(self.engine.pool.calls, [])
        self.assertTrue(self.alerts[-1][1])

    def test_waits_for_figures(self):
        self.poll(question(screenshots=[]))
        self.assertEqual(self.engine.pool.calls, [])

    def test_image_backed_question_is_sent_complete_to_vision_solver(self):
        snapshot = question(question="", questionSource="visible_image", questionImage={"source":"https://assets.example/slide.png"})
        self.poll(snapshot)
        self.assertEqual(len(self.engine.pool.calls), 1)
        self.assertEqual(self.engine.pool.calls[0][1][0], snapshot)

    def test_image_marker_without_a_real_image_cannot_bypass_missing_text(self):
        self.poll(question(question="", questionSource="visible_image", questionImage={}))
        self.assertEqual(self.engine.pool.calls, [])
        self.assertTrue(self.alerts[-1][1])

    def test_question_forwarded_completely(self):
        snapshot = question(question="Long question " * 5000, figures=[{"alt": "Rectangle 3 × 4"}])
        self.poll(snapshot)
        passed = self.engine.pool.calls[0][1][0]
        self.assertEqual(passed, snapshot)
        self.assertIsNot(passed, snapshot)

    def test_solves_once_across_repeated_polls(self):
        for _ in range(8): self.poll(question())
        self.assertEqual(len(self.engine.pool.calls), 1)

    def test_stale_answer_is_discarded(self):
        self.poll(question())
        self.poll(question("q2"))
        self.engine.pool.future.set_result(copy.deepcopy(ANSWER))
        self.assertIsNone(self.engine.pending)
        self.assertIsNone(self.poll(question("q2"))["command"])
        self.assertEqual(len(self.engine.pool.calls), 2)

    def test_pause_discards_inflight_answer(self):
        self.poll(question())
        self.engine.stop()
        self.engine.pool.future.set_result(copy.deepcopy(ANSWER))
        self.assertIsNone(self.engine.pending)

    def test_dispatch_is_persisted_and_never_retried_after_restart(self):
        self.solve()
        command = self.poll(question())["command"]
        self.assertEqual(command["kind"], "answer")
        self.assertEqual(self.engine._history_status("q1"), "dispatched")
        self.assertIsNone(self.poll(question())["command"])
        restarted = Engine(Path(self.directory.name))
        try:
            self.assertEqual(restarted._history_status("q1"), "dispatched")
        finally:
            restarted.pool.shutdown()

    def test_confirmed_answer_is_recorded(self):
        self.solve()
        command = self.poll(question())["command"]
        self.poll(question(state="submitted"), result={"id": command["id"], "ok": True})
        self.assertEqual(self.engine._history_status("q1"), "submitted")

    def test_uncertain_submission_is_alerted_and_not_repeated(self):
        self.solve()
        command = self.poll(question())["command"]
        self.poll(question(), result={"id": command["id"], "ok": False, "message": "Acknowledgment unclear"})
        self.assertTrue(self.alerts[-1][1])
        self.assertIsNone(self.poll(question())["command"])
        with self.assertRaises(ValueError): self.engine.retry_current()

    def test_watchdog_alerts_once_and_clears_queued_command(self):
        self.solve()
        self.engine.started_at = time.monotonic() - 30
        self.engine.last_seen = time.monotonic() - 30
        self.engine.watchdog(); self.engine.watchdog()
        self.assertEqual(len([a for a in self.alerts if a[1]]), 1)
        self.assertIsNone(self.engine.pending)

    def test_failure_is_deduplicated_and_recovery_allows_alert_again(self):
        for _ in range(3): self.engine.poll({"error": "Login failed"})
        self.assertEqual(len(self.alerts), 1)
        self.poll(question(state="waiting"))
        self.engine.poll({"error": "Login failed"})
        self.assertEqual(len([a for a in self.alerts if a[1]]), 2)

    def test_solver_failure_blocks_until_explicit_retry(self):
        self.poll(question())
        self.engine.pool.future.set_exception(SolverError("Solver timed out"))
        self.poll(question())
        self.assertEqual(len(self.engine.pool.calls), 1)
        self.engine.retry_current()
        self.poll(question())
        self.assertEqual(len(self.engine.pool.calls), 2)

    def test_settings_cannot_change_while_running_and_hide_secrets(self):
        with self.assertRaises(ValueError): self.engine.update_settings({"model": "test"})
        self.assertNotIn("discord_webhook", self.engine.public_state()["settings"])
        self.assertNotIn("api_key", self.engine.public_state()["settings"])

    def test_route_changes_do_not_duplicate_class_started_alert(self):
        self.poll({"state":"join", "sessionId":"course-lobby", "fingerprint":"join", "joinSelector":"button"})
        self.poll({"state":"waiting", "sessionId":"polling-route", "fingerprint":"waiting"})
        self.assertEqual(len(self.alerts), 1)

    def test_later_class_can_join_the_same_course_again(self):
        lobby={"state":"join", "sessionId":"same-course", "fingerprint":"join", "joinSelector":"button"}
        self.assertEqual(self.poll(lobby)["command"]["kind"], "join")
        self.poll({"state":"ended", "fingerprint":"ended"})
        self.assertEqual(self.poll(lobby)["command"]["kind"], "join")
        self.assertEqual(len(self.alerts), 2)

    def test_acknowledgment_only_poll_preserves_next_command_until_regular_poll(self):
        self.solve()
        self.assertIsNone(self.poll(question(), acknowledgmentOnly=True)["command"])
        self.assertNotIn("q1", self.engine.history)
        self.assertEqual(self.poll(question())["command"]["kind"], "answer")

    def test_action_result_is_processed_even_if_browser_then_fails(self):
        self.solve()
        command=self.poll(question())["command"]
        self.engine.poll({"error":"Browser closed", "result":{"id":command["id"], "ok":True}})
        self.assertEqual(self.engine._history_status("q1"), "submitted")

    def test_failed_settings_write_does_not_change_live_settings(self):
        self.engine.stop()
        old=copy.deepcopy(self.engine.config)
        with patch.object(self.engine, "_save", side_effect=OSError("read-only file")):
            with self.assertRaises(OSError): self.engine.update_settings({"model":"new-model"})
        self.assertEqual(self.engine.config, old)

    def test_non_object_config_does_not_crash_startup(self):
        from iclicker_bot.engine import DEFAULTS
        (Path(self.directory.name)/"config.json").write_text("[]",encoding="utf-8")
        engine=Engine(Path(self.directory.name))
        try:self.assertEqual(engine.config,DEFAULTS)
        finally:engine.pool.shutdown()

    def test_tab_access_failure_is_not_reported_as_a_healthy_browser(self):
        self.engine.poll({"error":"Tab is closed"})
        state=self.engine.public_state()
        self.assertTrue(state["bridge_connected"])
        self.assertFalse(state["connected"])

    def test_missing_question_alerts_and_queues_one_random_visible_choice(self):
        self.engine.config["random_fallback"]=True
        snapshot=question(question="")
        command=self.poll(snapshot)["command"]
        self.assertTrue(command["random_fallback"])
        self.assertIn(command["answer"]["option_ids"][0],[o["id"] for o in snapshot["options"]])
        self.assertEqual(len(command["answer"]["option_ids"]),1)
        self.assertTrue(self.alerts[-1][1])
        self.assertIn("random choice",self.alerts[-1][0])
        self.assertIsNone(self.poll(snapshot)["command"])

    def test_solver_timeout_uses_random_fallback_when_enabled(self):
        self.engine.config["random_fallback"]=True
        self.poll(question())
        self.engine.pool.future.set_exception(SolverError("Solver timed out"))
        self.assertTrue(self.poll(question())["command"]["random_fallback"])

    def test_needs_help_uses_random_fallback_when_enabled(self):
        self.engine.config["random_fallback"]=True
        self.poll(question())
        self.engine.pool.future.set_result({"status":"needs_help","option_ids":[],"text_answer":"","reason":"Missing figure"})
        self.assertTrue(self.poll(question())["command"]["random_fallback"])

    def test_random_fallback_never_uses_ambiguous_or_non_single_choice_controls(self):
        self.engine.config["random_fallback"]=True
        for kind in ("text","multiple","unknown"):
            self.assertIsNone(self.poll(question(kind,question="",inputKind=kind))["command"])
        self.assertIsNone(self.poll(question("ambiguous",question="",controlsClear=False))["command"])
        self.assertEqual(self.engine.pool.calls,[])

    def test_capture_failure_can_use_random_fallback_without_guessing_question_text(self):
        self.engine.config["random_fallback"]=True
        command=self.poll(question(captureProblem="Screenshot unavailable",screenshots=[]))["command"]
        self.assertTrue(command["random_fallback"])
        self.assertEqual(self.engine.pool.calls,[])

    def test_manual_changes_are_not_overwritten_after_random_submission(self):
        self.engine.config["random_fallback"]=True
        snapshot=question(question="")
        command=self.poll(snapshot)["command"]
        self.poll({**snapshot,"state":"submitted"},result={"id":command["id"],"ok":True})
        self.assertIsNone(self.poll(snapshot)["command"])
        self.assertEqual(self.engine.pool.calls,[])

    def test_late_model_result_cannot_overwrite_a_queued_random_choice(self):
        self.engine.config["random_fallback"]=True
        self.poll(question())
        self.engine._queue_random(question(),"Deadline is near")
        identifier=self.engine.pending["id"]
        self.engine.pool.future.set_result(copy.deepcopy(ANSWER))
        self.assertEqual(self.engine.pending["id"],identifier)
        self.assertTrue(self.engine.pending["random_fallback"])

    def test_network_hint_can_alert_about_an_unreadable_poll_but_cannot_submit(self):
        self.engine.config["random_fallback"]=True
        self.poll({"state":"history","fingerprint":"history","signals":{"lastEvent":{"kind":"question","key":"new-q","ageSeconds":10}}})
        self.assertTrue(self.alerts[-1][1])
        self.assertIn("announced a new question",self.alerts[-1][0])
        self.assertIsNone(self.engine.pending)

    def test_identical_question_in_a_new_class_is_not_blocked_by_the_previous_class(self):
        self.solve()
        command=self.poll(question())["command"]
        self.poll(question(state="submitted"),result={"id":command["id"],"ok":True})
        previous=self.engine.class_run
        self.poll({"state":"ended","fingerprint":"ended"})
        self.poll(question())
        self.assertNotEqual(self.engine.class_run,previous)
        self.assertEqual(len(self.engine.pool.calls),2)

    def test_random_alert_is_repeated_for_a_new_class_even_if_the_question_is_identical(self):
        self.engine.config["random_fallback"]=True
        snapshot=question(question="")
        first=self.poll(snapshot)["command"]
        self.poll({**snapshot,"state":"submitted"},result={"id":first["id"],"ok":True})
        self.poll({"state":"ended","fingerprint":"ended"})
        second=self.poll(snapshot)["command"]
        self.assertTrue(second["random_fallback"])
        self.assertEqual(len([entry for entry in self.alerts if entry[1]]),2)

    def test_loading_question_image_gets_a_brief_grace_period_before_random_fallback(self):
        self.engine.config["random_fallback"]=True
        snapshot=question(question="",contentLoading=True)
        with patch("time.monotonic",return_value=100):self.assertIsNone(self.poll(snapshot)["command"])
        with patch("time.monotonic",return_value=103):self.assertTrue(self.poll(snapshot)["command"]["random_fallback"])

    def test_image_loading_grace_is_skipped_when_a_visible_deadline_is_imminent(self):
        self.engine.config["random_fallback"]=True
        snapshot=question(question="",contentLoading=True,remainingSeconds=2)
        self.assertTrue(self.poll(snapshot)["command"]["random_fallback"])

    def test_three_consecutive_questions_are_solved_and_submitted_without_stopping(self):
        for index in range(1,4):
            snapshot=question(f"q{index}")
            self.poll(snapshot)
            self.engine.pool.future.set_result(copy.deepcopy(ANSWER))
            command=self.poll(snapshot)["command"]
            self.assertEqual(command["kind"],"answer")
            self.poll({**snapshot,"state":"submitted"},result={"id":command["id"],"ok":True})
            self.assertTrue(self.engine.running)
            self.assertEqual(self.engine._history_status(snapshot["fingerprint"]),"submitted")
            self.assertIsNone(self.poll({**snapshot,"state":"submitted"})["command"])
            self.poll({"state":"waiting","sessionId":"session1","fingerprint":f"waiting-{index}"})
        self.assertEqual(len(self.engine.pool.calls),3)
        self.assertEqual(self.engine.public_state()["poll_seconds"],3)

    def test_random_fallback_is_followed_by_normal_solving_of_the_next_question(self):
        self.engine.config["random_fallback"]=True
        first=question(question="")
        random=self.poll(first)["command"]
        self.assertTrue(random["random_fallback"])
        self.poll({**first,"state":"submitted"},result={"id":random["id"],"ok":True})
        following=question("q2")
        self.poll(following)
        self.engine.pool.future.set_result(copy.deepcopy(ANSWER))
        solved=self.poll(following)["command"]
        self.assertFalse(solved.get("random_fallback",False))
        self.assertTrue(self.engine.running)
        self.assertEqual(len(self.engine.pool.calls),1)

    def test_a_failed_question_does_not_stop_later_questions(self):
        self.poll(question())
        self.engine.pool.future.set_exception(SolverError("Solver failed"))
        self.poll(question("q2"))
        self.assertTrue(self.engine.running)
        self.assertEqual(len(self.engine.pool.calls),2)


if __name__ == "__main__":
    unittest.main()
