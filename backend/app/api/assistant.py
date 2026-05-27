from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.assistant_llm import generate_llm_answer, llm_is_configured
from app.services.assistant_retrieval import build_assistant_reply, load_assistant_documents


router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class AssistantChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=8)
    context: dict[str, Any] | None = None


class AssistantSourceResponse(BaseModel):
    title: str
    path: str
    heading: str
    score: float


class AssistantActionResponse(BaseModel):
    type: str
    label: str
    value: str | None = None


class AssistantChatResponse(BaseModel):
    answer: str
    sources: list[AssistantSourceResponse]
    suggested_actions: list[AssistantActionResponse]
    meta: dict[str, Any]


@router.post("/chat", response_model=AssistantChatResponse)
def chat_with_assistant(payload: AssistantChatRequest) -> AssistantChatResponse:
    chunks = list(load_assistant_documents())
    reply = build_assistant_reply(payload.question, chunks, top_k=payload.top_k)
    llm_result = generate_llm_answer(payload.question, reply.matched_chunks, payload.context or {})
    answer = llm_result.answer if llm_result else reply.answer
    return AssistantChatResponse(
        answer=answer,
        sources=[
            AssistantSourceResponse(
                title=source.title,
                path=source.path,
                heading=source.heading,
                score=source.score,
            )
            for source in reply.sources
        ],
        suggested_actions=[
            AssistantActionResponse(
                type=action.type,
                label=action.label,
                value=action.value,
            )
            for action in reply.suggested_actions
        ],
        meta={
            "retrieval": "local_markdown_top_k",
            "answer_mode": "llm" if llm_result else "local_fallback",
            "llm_configured": llm_is_configured(),
            "llm_mode": llm_result.mode if llm_result else None,
            "llm_model": llm_result.model if llm_result else None,
            "chunk_count": len(chunks),
            "matched_chunk_count": len(reply.matched_chunks),
            "context": payload.context or {},
        },
    )
