from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.services.assistant_retrieval import AssistantChunk


SYSTEM_INSTRUCTIONS = """你是 Urban Taxi Vis 项目的产品与技术助手。
你的主要对象可能是普通用户、验收老师、开发者或项目维护者；不要默认把用户当成正在准备答辩的学生。
只能根据给定的项目文档片段回答，不要编造文档中没有的功能。
默认直接回答问题，语气自然、简洁、客观，不要主动使用“答辩时可以说”“可以总结为”“老师问到时”等话术。
只有当用户明确提到“答辩、老师、汇报、PPT、怎么讲、验收话术”时，才可以给答辩式总结或讲述口径。
如果用户问算法，要点出数据结构或算法关键词，例如 Top-K、倒排索引、空间索引、H3、Jaccard、地图匹配等。
如果用户问“具体逻辑、代码逻辑、实现、为什么、怎么算”，优先按“输入参数 -> 数据源/表 -> 后端计算流程 -> 前端展示 -> 复杂度或局限”回答，避免只解释功能用途。
如果文档片段不足，直接说明目前文档没有覆盖，并给出可补充的文档方向。"""


@dataclass(frozen=True)
class LlmResult:
    answer: str
    mode: str
    model: str


def llm_is_configured() -> bool:
    return bool(settings.openai_api_key.strip())


def generate_llm_answer(
    question: str,
    chunks: list[AssistantChunk],
    context: dict[str, Any] | None = None,
) -> LlmResult | None:
    if not llm_is_configured() or not chunks:
        return None

    mode = settings.openai_api_mode.strip().lower()
    if mode in {"responses", "response"}:
        return _call_responses_api(question, chunks, context)
    return _call_chat_completions_api(question, chunks, context)


def build_grounded_prompt(
    question: str,
    chunks: list[AssistantChunk],
    context: dict[str, Any] | None = None,
) -> str:
    context_text = json.dumps(context or {}, ensure_ascii=False)
    docs_text = "\n\n".join(
        f"[{index}] 来源: {chunk.path} / {chunk.heading}\n{chunk.content[:1200]}"
        for index, chunk in enumerate(chunks[:6], start=1)
    )
    return (
        f"用户问题：{question}\n\n"
        f"前端上下文：{context_text}\n\n"
        "可用项目文档片段：\n"
        f"{docs_text}\n\n"
        "请基于这些片段回答。最后用一句话提示用户可以查看来源列表。"
    )


def _call_chat_completions_api(
    question: str,
    chunks: list[AssistantChunk],
    context: dict[str, Any] | None,
) -> LlmResult | None:
    payload = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": SYSTEM_INSTRUCTIONS},
            {"role": "user", "content": build_grounded_prompt(question, chunks, context)},
        ],
        "max_tokens": settings.openai_max_output_tokens,
    }
    data = _post_json(_join_url(settings.openai_base_url, "chat/completions"), payload)
    answer = _extract_chat_content(data)
    return LlmResult(answer=answer, mode="chat_completions", model=settings.openai_model) if answer else None


def _call_responses_api(
    question: str,
    chunks: list[AssistantChunk],
    context: dict[str, Any] | None,
) -> LlmResult | None:
    payload = {
        "model": settings.openai_model,
        "instructions": SYSTEM_INSTRUCTIONS,
        "input": build_grounded_prompt(question, chunks, context),
        "max_output_tokens": settings.openai_max_output_tokens,
    }
    data = _post_json(_join_url(settings.openai_base_url, "responses"), payload)
    answer = _extract_response_text(data)
    return LlmResult(answer=answer, mode="responses", model=settings.openai_model) if answer else None


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {settings.openai_api_key.strip()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.openai_timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {}


def _join_url(base_url: str, suffix: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith(f"/{suffix}"):
        return base
    return f"{base}/{suffix}"


def _extract_chat_content(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts).strip()
    return ""


def _extract_response_text(data: dict[str, Any]) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = data.get("output")
    if not isinstance(output, list):
        return ""
    parts: list[str] = []
    for item in output:
        content = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
    return "\n".join(parts).strip()
