import unittest

from fastapi.testclient import TestClient

from app.main import app


class AssistantApiTest(unittest.TestCase):
    def test_chat_endpoint_returns_answer_sources_and_actions(self) -> None:
        client = TestClient(app)

        response = client.post(
            "/api/v1/assistant/chat",
            json={"question": "F8 高频路线怎么做？帮我放大地图", "top_k": 3},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("answer", body)
        self.assertTrue(body["sources"])
        self.assertTrue(any(action["type"] == "zoom_in" for action in body["suggested_actions"]))


if __name__ == "__main__":
    unittest.main()
