import unittest

from app.services.assistant_retrieval import (
    AssistantChunk,
    build_assistant_reply,
    detect_map_actions,
    retrieve_top_k,
    split_markdown_sections,
    tokenize_text,
)


class AssistantRetrievalTest(unittest.TestCase):
    def test_split_markdown_sections_keeps_headings_and_paths(self) -> None:
        chunks = split_markdown_sections(
            "docs/sample.md",
            "# 功能清单\n\n## F8 A/B 高频路线挖掘\n\nF8 基于候选 trip 和路线 token 聚类。\n\n## F9 分时段最优路径推荐\n\nF9 按时间分桶比较路线。",
        )

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0].title, "功能清单")
        self.assertEqual(chunks[0].heading, "F8 A/B 高频路线挖掘")
        self.assertEqual(chunks[0].path, "docs/sample.md")
        self.assertIn("路线 token 聚类", chunks[0].content)

    def test_retrieve_top_k_prefers_matching_feature_terms(self) -> None:
        chunks = [
            AssistantChunk(
                id="docs/a.md#0",
                path="docs/a.md",
                title="用户手册",
                heading="F1 轨迹查询",
                content="F1 支持按车辆编号和时间范围查询出租车轨迹。",
            ),
            AssistantChunk(
                id="docs/b.md#0",
                path="docs/b.md",
                title="功能清单",
                heading="F8 A/B 高频路线挖掘",
                content="F8 使用候选 trip、路线 token、Jaccard 相似度和 Top-K 排序挖掘常用路线。",
            ),
        ]

        results = retrieve_top_k("F8 怎么找 A/B 高频路线", chunks, top_k=1)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].chunk.heading, "F8 A/B 高频路线挖掘")
        self.assertGreater(results[0].score, 0)

    def test_tokenize_text_keeps_feature_code_next_to_chinese_text(self) -> None:
        tokens = tokenize_text("F1的路径计算逻辑是什么？F7-F9 没有结果怎么办？")

        self.assertIn("f1", tokens)
        self.assertIn("f7", tokens)
        self.assertIn("f9", tokens)

    def test_retrieve_top_k_keeps_f1_logic_above_generic_faq(self) -> None:
        chunks = [
            AssistantChunk(
                id="docs/faq.md#0",
                path="docs/faq.md",
                title="FAQ",
                heading="为什么配置好后数据不显示？",
                content="需要检查数据库、后端服务和时间范围。",
            ),
            AssistantChunk(
                id="docs/f1.md#0",
                path="docs/f1.md",
                title="F1 轨迹查询与路径生成逻辑",
                heading="F1 原始轨迹从散点到折线",
                content="F1 原始数据是一系列 GPS 散点。后端按时间排序，使用 ST_MakeLine 生成原始轨迹折线。",
            ),
        ]

        results = retrieve_top_k("这里的F1的路径计算逻辑是什么，原数据不应该是一系列散点吗", chunks, top_k=1)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].chunk.heading, "F1 原始轨迹从散点到折线")

    def test_feature_query_demotes_chunks_without_matching_feature_number(self) -> None:
        chunks = [
            AssistantChunk(
                id="docs/faq.md#0",
                path="docs/faq.md",
                title="FAQ",
                heading="为什么数据不显示？",
                content="需要检查数据库、后端服务、时间范围和地图缩放。",
            ),
            AssistantChunk(
                id="docs/f8.md#0",
                path="docs/f8.md",
                title="F1-F9 核心代码逻辑说明",
                heading="F8 A/B 高频路线挖掘代码逻辑",
                content="F8 从 A/B 候选 trip 截取道路边序列，生成路线 token，使用 Jaccard 相似度和连通分量聚类。",
            ),
        ]

        results = retrieve_top_k("F8 的具体代码逻辑是什么，为什么可信", chunks, top_k=2)

        self.assertEqual(results[0].chunk.heading, "F8 A/B 高频路线挖掘代码逻辑")
        self.assertLess(results[1].score, results[0].score)

    def test_implementation_query_prefers_code_logic_chunk_over_feature_summary(self) -> None:
        chunks = [
            AssistantChunk(
                id="docs/feature.md#0",
                path="docs/01-overview/feature-list.md",
                title="功能清单",
                heading="F9 分时段最优路径推荐",
                content="F9 按时间分桶比较路线通行效率，给出推荐路径。",
            ),
            AssistantChunk(
                id="docs/logic.md#0",
                path="docs/05-technical-notes/f1-f9-code-logic.md",
                title="核心功能代码逻辑说明",
                heading="F9 分时段最优路径推荐代码逻辑",
                content="F9 将时间过滤下推到 F8，每个时间桶复用 F8 高频路线挖掘，再按 p50、平均耗时、p90 和 trip_count 排序。",
            ),
        ]

        results = retrieve_top_k("F9 分时段最优路径推荐的代码逻辑是什么", chunks, top_k=2)

        self.assertEqual(results[0].chunk.heading, "F9 分时段最优路径推荐代码逻辑")

    def test_detect_map_actions_for_zoom_and_style(self) -> None:
        actions = detect_map_actions("帮我放大地图，并切换到底图极夜蓝")

        self.assertEqual(actions[0].type, "zoom_in")
        self.assertTrue(any(action.type == "set_map_style" and action.value == "darkblue" for action in actions))

    def test_build_assistant_reply_returns_sources_and_actions(self) -> None:
        chunks = [
            AssistantChunk(
                id="docs/feature.md#0",
                path="docs/feature.md",
                title="功能清单",
                heading="F4 网格密度分析",
                content="F4 按空间网格聚合轨迹点，展示热力图或分级密度图。适合观察区域热点。",
            )
        ]

        reply = build_assistant_reply("F4 是做什么的？顺便放大地图", chunks, top_k=3)

        self.assertIn("F4", reply.answer)
        self.assertEqual(reply.sources[0].path, "docs/feature.md")
        self.assertEqual(reply.suggested_actions[0].type, "zoom_in")


if __name__ == "__main__":
    unittest.main()
