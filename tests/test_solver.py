import copy
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from unittest.mock import Mock
import subprocess

from iclicker_bot.engine import DEFAULTS
from iclicker_bot.solver import ModelUnavailable, Solver, SolverError, validate_answer


class SolverTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {"inputKind": "single", "question": "What is 2 + 2?", "options": [{"id": "a", "text": "4"}]}
        self.answer = {"status": "answer", "option_ids": ["a"], "text_answer": "", "reason": "Arithmetic"}

    def test_unknown_option_rejected(self):
        self.answer["option_ids"] = ["invented"]
        with self.assertRaises(SolverError): validate_answer(self.answer, self.snapshot)

    def test_multiple_choices_for_single_rejected(self):
        self.answer["option_ids"] = ["a", "a"]
        with self.assertRaises(SolverError): validate_answer(self.answer, self.snapshot)

    def test_text_requires_only_text(self):
        self.snapshot["inputKind"] = "text"
        with self.assertRaises(SolverError): validate_answer(self.answer, self.snapshot)
        self.answer.update(option_ids=[], text_answer="4")
        self.assertEqual(validate_answer(self.answer, self.snapshot), self.answer)

    def test_automatic_fallback_and_remembered_working_model(self):
        config = copy.deepcopy(DEFAULTS)
        config.update(model="requested", fallback_models=["next-best", "third"])
        events = []
        solver = Solver(config, events.append)
        with patch.object(solver, "_codex", side_effect=[ModelUnavailable(), self.answer, self.answer]) as invoke:
            self.assertEqual(solver.solve(self.snapshot)["model"], "next-best")
            self.assertEqual(solver.solve(self.snapshot)["model"], "next-best")
            self.assertEqual([call.args[0] for call in invoke.call_args_list], ["requested", "next-best", "next-best"])
        self.assertEqual(len(events), 1)

    def test_network_failures_do_not_start_model_fallback_chain(self):
        solver = Solver(copy.deepcopy(DEFAULTS))
        with patch.object(solver, "_codex", side_effect=SolverError("network unavailable")) as invoke:
            with self.assertRaises(SolverError): solver.solve(self.snapshot)
            self.assertEqual(invoke.call_count, 1)

    def test_all_unavailable_alerts_cleanly(self):
        solver = Solver(copy.deepcopy(DEFAULTS))
        with patch.object(solver, "_codex", side_effect=ModelUnavailable()):
            with self.assertRaisesRegex(SolverError, "None of the configured"):
                solver.solve(self.snapshot)

    def test_api_sends_images_schema_and_no_history(self):
        config = copy.deepcopy(DEFAULTS)
        config.update(provider="api", api_key="TEST_KEY")
        solver = Solver(config)
        self.snapshot.update(screenshots=["aW1hZ2U="], visibleText="Complete visible question", figures=[{"alt":"Relevant figure"}])
        result = {"status":"completed", "output":[{"type":"reasoning"}, {"type":"message", "content":[{"type":"output_text", "text":json.dumps(self.answer)}]}]}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps(result).encode())) as invoke:
            solver.solve(self.snapshot)
        request = invoke.call_args.args[0]
        payload = json.loads(request.data)
        self.assertFalse(payload["store"])
        self.assertNotIn("previous_response_id", payload)
        self.assertNotIn("conversation", payload)
        self.assertEqual(payload["input"][0]["content"][1]["image_url"], "data:image/png;base64,aW1hZ2U=")
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertIn("Complete visible question", payload["input"][0]["content"][0]["text"])

    def test_cli_uses_fresh_session_and_passes_complete_context_and_image(self):
        solver = Solver(copy.deepcopy(DEFAULTS))
        self.snapshot.update(screenshots=["aW1hZ2U="], visibleText="Full visible question and figures")
        def run(args, **kwargs):
            self.assertIn("--ephemeral", args)
            self.assertIn("--image", args)
            self.assertNotIn("resume", args)
            self.assertNotIn("fork", args)
            self.assertEqual(args[args.index("--sandbox")+1], "read-only")
            self.assertEqual(args[-1], "-")
            self.assertIn("Full visible question and figures", kwargs["input"])
            image = Path(args[args.index("--image")+1])
            self.assertEqual(image.read_bytes(), b"image")
            Path(args[args.index("--output-last-message")+1]).write_text(json.dumps(self.answer), encoding="utf-8")
            return SimpleNamespace(returncode=0)
        with patch("shutil.which", return_value="codex.exe"), patch("iclicker_bot.solver.run_solver_process", side_effect=run):
            self.assertEqual(solver.solve(self.snapshot)["model"], DEFAULTS["model"])

    def test_random_fallback_budget_respects_visible_time_remaining(self):
        config=copy.deepcopy(DEFAULTS)
        config.update(random_fallback=True,random_wait_seconds=12,solver_timeout=90)
        solver=Solver(config)
        self.assertEqual(solver.timeout_for({}),12)
        self.assertEqual(solver.timeout_for({"remainingSeconds":8}),5)

    def test_all_model_attempts_share_one_time_budget(self):
        config=copy.deepcopy(DEFAULTS)
        config.update(random_fallback=True,random_wait_seconds=12)
        solver=Solver(config)
        with patch("time.monotonic",return_value=100):solver.deadline=112
        with patch("time.monotonic",return_value=110):self.assertEqual(solver.timeout_for({}),2)
        with patch("time.monotonic",return_value=113):
            with self.assertRaises(SolverError):solver.timeout_for({})

    def test_timed_out_solver_process_is_terminated(self):
        from iclicker_bot.solver import run_solver_process
        process=Mock()
        process.communicate.side_effect=[subprocess.TimeoutExpired('codex',1),('','')]
        with patch('subprocess.Popen',return_value=process),patch('iclicker_bot.solver.terminate_solver_tree') as terminate:
            with self.assertRaises(subprocess.TimeoutExpired):run_solver_process(['codex'],input='question',timeout=1,cwd='.')
            terminate.assert_called_once_with(process)


if __name__ == "__main__": unittest.main()
