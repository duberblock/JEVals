import json
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import local_emulator


class BuildClassifierRequestTestCase(unittest.TestCase):
    def test_injects_the_default_model_and_passes_state_and_questions(self):
        systemone = {
            "state": "The customer was charged twice.",
            "questions": {
                "fraud": {
                    "type": "choice",
                    "instructions": "Classify.",
                    "criteria": {"yes": None, "no": None},
                }
            },
        }
        payload = local_emulator.build_classifier_request(systemone, "m1")
        self.assertEqual(payload["model"], "m1")
        self.assertEqual(payload["state"], systemone["state"])
        self.assertEqual(payload["questions"], systemone["questions"])

    def test_a_request_model_wins_over_the_default(self):
        payload = local_emulator.build_classifier_request(
            {"state": "s", "questions": {}, "model": "chosen"}, "default"
        )
        self.assertEqual(payload["model"], "chosen")

    def test_missing_state_or_questions_is_rejected(self):
        with self.assertRaises(ValueError):
            local_emulator.build_classifier_request({"questions": {}}, "m")
        with self.assertRaises(ValueError):
            local_emulator.build_classifier_request({"state": "s"}, "m")


class BuildSystemoneResultTestCase(unittest.TestCase):
    def test_maps_answers_usage_and_model(self):
        classifier = {
            "model": "m1",
            "usage": {"input_tokens": 12, "output_tokens": 3},
            "answers": {
                "q": {
                    "type": "choice",
                    "choice": "yes",
                    "confidence": 0.82,
                    "probabilities": {"yes": 0.82, "no": 0.18},
                    "extra_upstream_field": "stripped",
                }
            },
        }
        result = local_emulator.build_systemone_result(classifier)
        self.assertEqual(result["model"], "m1")
        self.assertEqual(result["usage"], {"input_tokens": 12, "output_tokens": 3})
        self.assertEqual(
            result["answers"]["q"],
            {
                "type": "choice",
                "choice": "yes",
                "confidence": 0.82,
                "probabilities": {"yes": 0.82, "no": 0.18},
            },
        )

    def test_missing_usage_falls_back_to_zeros(self):
        result = local_emulator.build_systemone_result(
            {"model": "m", "answers": {"q": {"type": "noul", "noul": 0.42, "timing": 1}}}
        )
        self.assertEqual(result["usage"], {"input_tokens": 0, "output_tokens": 0})
        self.assertEqual(result["answers"]["q"], {"type": "noul", "noul": 0.42})

    def test_unsupported_or_incomplete_answers_are_rejected(self):
        with self.assertRaises(ValueError):
            local_emulator.build_systemone_result(
                {"model": "m", "answers": {"q": {"type": "haiku"}}}
            )
        with self.assertRaises(ValueError):
            local_emulator.build_systemone_result(
                {"model": "m", "answers": {"q": {"type": "choice", "choice": "yes"}}}
            )
        with self.assertRaises(ValueError):
            local_emulator.build_systemone_result({"model": "m", "answers": {}})


class _StubClassifier(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("Authorization") == "Bearer k":
            reply = {"model": "auth-model", "answers": {"q": {"type": "noul", "noul": 0.5}}, "usage": {}}
        else:
            reply = {
                "model": body["model"],
                "answers": {
                    "q": {
                        "type": "choice",
                        "choice": "yes",
                        "confidence": 0.9,
                        "probabilities": {"yes": 0.9, "no": 0.1},
                    }
                },
                "usage": {"input_tokens": 5, "output_tokens": 1},
            }
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class EndToEndTestCase(unittest.TestCase):
    """The adapter server wired against a stub classifier (hermetic)."""

    def test_systemone_flows_through_to_the_classifier_contract(self):
        stub = ThreadingHTTPServer(("127.0.0.1", 0), _StubClassifier)
        threading.Thread(target=stub.serve_forever, daemon=True).start()
        try:
            local_emulator._Handler.base = f"http://127.0.0.1:{stub.server_port}"
            local_emulator._Handler.api_key = None
            local_emulator._Handler.default_model = "stub-model"
            adapter = ThreadingHTTPServer(("127.0.0.1", 0), local_emulator._Handler)
            threading.Thread(target=adapter.serve_forever, daemon=True).start()
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{adapter.server_port}/v1/systemone",
                    data=json.dumps(
                        {
                            "state": "charged twice",
                            "questions": {
                                "q": {
                                    "type": "choice",
                                    "instructions": "pick",
                                    "criteria": {"yes": None, "no": None},
                                }
                            },
                        }
                    ).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=10) as response:
                    result = json.loads(response.read())
                self.assertEqual(result["model"], "stub-model")
                self.assertEqual(result["usage"], {"input_tokens": 5, "output_tokens": 1})
                self.assertEqual(result["answers"]["q"]["choice"], "yes")
                self.assertNotIn("instructions", result["answers"]["q"])
            finally:
                adapter.shutdown()
        finally:
            stub.shutdown()


if __name__ == "__main__":
    unittest.main()
