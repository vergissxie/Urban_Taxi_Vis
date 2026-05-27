import unittest

from app.services.assistant_llm import (
    build_grounded_prompt,
    _extract_chat_content,
    _extract_response_text,
)
from app.services.assistant_retrieval import AssistantChunk


class AssistantLlmTest(unittest.TestCase):
    def test_build_grounded_prompt_contains_question_context_and_sources(self) -> None:
        prompt = build_grounded_prompt(
            "F8 怎么找高频路线？",
            [
                AssistantChunk(
                    id="docs/a.md#0",
                    path="docs/a.md",
                    title="功能清单",
                    heading="F8 A/B 高频路线挖掘",
                    content="F8 使用候选 trip、路线 token 和 Top-K 排序。",
                )
            ],
            {"mode": "decision"},
        )

        self.assertIn("F8 怎么找高频路线", prompt)
        self.assertIn("decision", prompt)
        self.assertIn("docs/a.md", prompt)
        self.assertIn("路线 token", prompt)

    def test_extract_chat_content_supports_openai_compatible_response(self) -> None:
        text = _extract_chat_content({"choices": [{"message": {"content": "回答内容"}}]})

        self.assertEqual(text, "回答内容")

    def test_extract_response_text_supports_responses_api_shape(self) -> None:
        text = _extract_response_text(
            {
                "output": [
                    {
                        "content": [
                            {"type": "output_text", "text": "第一段"},
                            {"type": "output_text", "text": "第二段"},
                        ]
                    }
                ]
            }
        )

        self.assertEqual(text, "第一段\n第二段")


if __name__ == "__main__":
    unittest.main()
