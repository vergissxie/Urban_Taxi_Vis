# AI 项目助手接口说明

AI 项目助手接口由 FastAPI 提供，用于接收用户问题，返回本地文档检索结果、回答文本、来源文档和建议动作。它的目标是帮助用户理解 F1-F9 操作、接口、数据流程和常见排障。

## 接口地址

```text
POST /api/v1/assistant/chat
```

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `question` | string | 是 | 用户问题，长度 1 到 500。 |
| `top_k` | number | 否 | 返回相关文档片段数量，默认 5，范围 1 到 8。 |
| `context` | object | 否 | 前端当前模式、功能、地图状态等上下文。 |

## 请求示例

```json
{
  "question": "F9 的 frequent_fast 策略怎么排序？",
  "top_k": 5,
  "context": {
    "mode": "decision",
    "activeFeature": "F9",
    "demoReadonly": true
  }
}
```

## 响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `answer` | string | 回答文本。 |
| `sources` | array | 命中的文档来源列表。 |
| `suggested_actions` | array | 前端可选动作建议，例如放大地图。 |
| `meta` | object | 检索模式、是否使用 LLM、命中文档数量和上下文。 |

响应示例：

```json
{
  "answer": "F9 不调用独立后端接口，而是在 F8 候选路线中按策略排序...",
  "sources": [
    {
      "title": "功能清单",
      "path": "docs/01-overview/feature-list.md",
      "heading": "F9 三策略路径推荐",
      "score": 12.3
    }
  ],
  "suggested_actions": [],
  "meta": {
    "retrieval": "local_markdown_top_k",
    "answer_mode": "llm",
    "llm_configured": true,
    "matched_chunk_count": 5
  }
}
```

## 后端实现位置

| 文件 | 作用 |
|---|---|
| `backend/app/api/assistant.py` | FastAPI 路由、请求/响应模型。 |
| `backend/app/services/assistant_retrieval.py` | 扫描 Markdown、切分章节、计算检索分数。 |
| `backend/app/services/assistant_llm.py` | 可选 OpenAI-compatible LLM 调用。 |
| `backend/app/core/config.py` | 读取 LLM 配置。 |

## 文档检索范围

当前检索允许读取：

- `README.md`
- `docs/01-overview`
- `docs/02-user-guide`
- `docs/03-developer-guide`
- `docs/04-architecture`
- `docs/05-technical-notes`

不在允许范围内的文件不会作为助手知识来源。

## LLM 配置

如果 `.env` 中配置了 `OPENAI_API_KEY`，接口会在检索片段基础上调用外部 OpenAI-compatible 服务生成回答。否则使用本地 fallback。

```env
OPENAI_API_KEY=your_openai_or_relay_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_MODE=chat_completions
OPENAI_TIMEOUT_SECONDS=30
OPENAI_MAX_OUTPUT_TOKENS=900
```

`OPENAI_API_MODE` 支持：

| 值 | 说明 |
|---|---|
| `chat_completions` | 调用 `/chat/completions`。 |
| `responses` | 调用 `/responses`。 |

## 前端使用方式

前端组件：`frontend/src/components/GeoWorkbenchAssistant.tsx`。

用户提问后，前端会调用 `/api/v1/assistant/chat`，并展示：

- 回答正文；
- 来源文档；
- 建议动作；
- 检索/LLM 元信息。

## 回答边界

- 助手回答必须基于项目文档和当前上下文。
- AI 助手不是数据库事实来源；真实数据以接口返回和地图展示为准。
- 如果某个深层文档仍残留旧 F9 time-bucket 说法，助手可能检索到旧口径，因此更新 F1-F9 逻辑时应同步更新相关 Markdown。
- 当前 F9 的正确口径是“前端基于 F8 候选路线三策略排序”，不是独立后端接口。
