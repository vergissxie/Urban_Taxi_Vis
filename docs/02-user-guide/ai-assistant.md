# AI 助手使用说明

AI 助手用于解释 F1-F9 功能、数据表、算法参数、运行方式和常见错误。它不是通用聊天机器人，而是围绕本项目文档和代码说明工作的项目助手。

## 能回答什么

| 类型 | 示例 |
|---|---|
| 功能使用 | “F4 网格密度怎么操作？”、“F8 怎么画 A/B 区域？” |
| 结果解释 | “F9 的 stable 策略是什么意思？”、“F7 的 road group 是什么？” |
| 数据依赖 | “F8 需要哪些表？”、“matched_trip_edges 从哪里来？” |
| 算法说明 | “HMM 地图匹配有哪些参数？”、“Jaccard 聚类怎么理解？” |
| 排错建议 | “关闭 Demo 后没有数据怎么办？”、“F7/F8 没结果怎么查？” |

## 推荐提问方式

尽量带上功能编号、现象和目标，例如：

```text
F4 网格密度没有显示颜色，应该检查哪些参数？
F8 A/B 高频路线中 strict_od 和 pass_through 有什么区别？
F9 的 fastest、stable、frequent_fast 三个策略分别适合什么场景？
我关闭 DEMO 后 F1 没有数据，应该检查哪些表和时间范围？
HMM 匹配的 search_radius_m、max_candidates、sigma_z、beta 分别控制什么？
```

比起“为什么不行”，更推荐问“F7 运行后没有道路结果，PostGIS 表和前端参数应该怎么排查”。

## 返回内容

| 内容 | 说明 |
|---|---|
| 回答正文 | 对问题的解释或排错步骤 |
| sources | 命中的文档来源，便于继续查阅 |
| actions | 如果识别到地图动作，可能返回建议操作 |
| meta | 检索、fallback、LLM 调用等附加信息 |

## 本地 RAG 与 LLM

系统会读取 `README.md` 和 `docs/` 中的 Markdown 文档，进行分块、关键词检索和 Top-K 排序。即使没有配置大模型 Key，也可以使用本地 fallback 回答。

如果配置了以下环境变量，后端会尝试调用 OpenAI-compatible LLM：

```env
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_MODE=chat_completions
```

如果 `OPENAI_API_KEY` 为空，AI 助手仍会使用本地文档检索结果回答，只是表达会更模板化。

## 注意事项

- AI 助手回答以项目文档和当前代码说明为准。
- 如果文档没有覆盖某个细节，它可能只能给出排查方向。
- F9 的正确口径是“前端基于 F8 结果排序推荐”，不是独立后端 time-bucket 接口。
- 涉及真实数据是否存在时，仍需要检查 PostGIS 表和时间范围。
