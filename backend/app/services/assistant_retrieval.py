from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable


REPO_ROOT = None
for candidate in Path(__file__).resolve().parents:
    if (candidate / "docs").exists() or (candidate / "README.md").exists():
        REPO_ROOT = candidate
        break
if REPO_ROOT is None:
    REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOCS_ROOT = REPO_ROOT / "docs"
FEATURE_TOKEN_RE = re.compile(r"(?<![a-z0-9])f\d+(?![a-z0-9])", re.IGNORECASE)

DOC_PATH_ALLOWLIST = {
    "README.md",
    "01-overview",
    "02-user-guide",
    "03-developer-guide",
    "04-architecture",
    "05-technical-notes",
}

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "for",
    "how",
    "is",
    "it",
    "of",
    "the",
    "to",
    "what",
    "with",
    "一下",
    "一个",
    "为什么",
    "什么",
    "介绍",
    "使用",
    "功能",
    "可以",
    "如何",
    "帮我",
    "怎么",
    "的是",
    "项目",
    "这里",
    "这个",
    "那个",
    "逻辑",
    "应该",
    "是不是",
}


@dataclass(frozen=True)
class AssistantChunk:
    id: str
    path: str
    title: str
    heading: str
    content: str


@dataclass(frozen=True)
class SearchResult:
    chunk: AssistantChunk
    score: float


@dataclass(frozen=True)
class AssistantSource:
    title: str
    path: str
    heading: str
    score: float


@dataclass(frozen=True)
class AssistantAction:
    type: str
    label: str
    value: str | None = None


@dataclass(frozen=True)
class AssistantReply:
    answer: str
    sources: list[AssistantSource]
    suggested_actions: list[AssistantAction]
    matched_chunks: list[AssistantChunk]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def tokenize_text(value: str) -> list[str]:
    text = normalize_text(value)
    tokens: list[str] = []
    tokens.extend(re.findall(r"[a-z][a-z0-9_+-]*|\d+(?:\.\d+)?", text))

    chinese_groups = re.findall(r"[\u4e00-\u9fff]+", text)
    for group in chinese_groups:
        chars = list(group)
        tokens.extend(chars)
        tokens.extend(group[i : i + 2] for i in range(max(0, len(group) - 1)))
        tokens.extend(group[i : i + 3] for i in range(max(0, len(group) - 2)))

    tokens.extend(_extract_feature_tokens(text))

    return [token for token in tokens if token and token not in STOP_WORDS and len(token) <= 40]


def split_markdown_sections(path: str, content: str) -> list[AssistantChunk]:
    title = _extract_title(content) or Path(path).stem
    heading_matches = list(re.finditer(r"^(#{2,4})\s+(.+?)\s*$", content, flags=re.MULTILINE))

    if not heading_matches:
        cleaned = _clean_markdown_text(content)
        return [
            AssistantChunk(
                id=f"{path}#0",
                path=path,
                title=title,
                heading=title,
                content=cleaned,
            )
        ] if cleaned else []

    chunks: list[AssistantChunk] = []
    for index, match in enumerate(heading_matches):
        start = match.end()
        end = heading_matches[index + 1].start() if index + 1 < len(heading_matches) else len(content)
        heading = match.group(2).strip()
        body = _clean_markdown_text(content[start:end])
        if not body:
            continue
        chunks.append(
            AssistantChunk(
                id=f"{path}#{len(chunks)}",
                path=path,
                title=title,
                heading=heading,
                content=body,
            )
        )
    return chunks


def build_inverted_index(chunks: Iterable[AssistantChunk]) -> dict[str, set[int]]:
    index: dict[str, set[int]] = defaultdict(set)
    for chunk_index, chunk in enumerate(chunks):
        for token in set(_chunk_tokens(chunk)):
            index[token].add(chunk_index)
    return dict(index)


def retrieve_top_k(question: str, chunks: list[AssistantChunk], top_k: int = 5) -> list[SearchResult]:
    query_tokens = tokenize_text(question)
    if not query_tokens or not chunks:
        return []

    query_counter = Counter(query_tokens)
    feature_matches = set(_extract_feature_tokens(question))
    wants_implementation_detail = _asks_for_implementation_detail(question)
    chunk_counters = [Counter(_chunk_tokens(chunk)) for chunk in chunks]
    doc_freq = Counter[str]()
    for counter in chunk_counters:
        doc_freq.update(counter.keys())

    results: list[SearchResult] = []
    total_docs = len(chunks)
    for chunk, counter in zip(chunks, chunk_counters):
        if not counter:
            continue
        score = 0.0
        heading_tokens = set(tokenize_text(f"{chunk.title} {chunk.heading}"))
        content_length = max(1, sum(counter.values()))
        for token, query_tf in query_counter.items():
            tf = counter.get(token, 0)
            if tf <= 0:
                continue
            idf = math.log((total_docs + 1) / (doc_freq[token] + 0.5)) + 1
            heading_boost = 1.8 if token in heading_tokens else 1.0
            score += query_tf * (tf / math.sqrt(content_length)) * idf * heading_boost

        compact_question = re.sub(r"\s+", "", question.lower())
        compact_heading = re.sub(r"\s+", "", f"{chunk.title}{chunk.heading}{chunk.content}".lower())
        if compact_question and compact_question in compact_heading:
            score += 2.0

        matched_requested_feature = not feature_matches
        feature_text = f"{chunk.title} {chunk.heading}".lower()
        feature_content = chunk.content.lower()
        for feature in feature_matches:
            if feature.lower() in feature_text:
                score += 6.0
                matched_requested_feature = True
            elif feature.lower() in feature_content:
                score += 2.0
                matched_requested_feature = True

        if feature_matches and not matched_requested_feature:
            score *= 0.03

        if (
            wants_implementation_detail
            and matched_requested_feature
            and _is_implementation_logic_chunk(chunk)
        ):
            score += 5.0

        if score > 0:
            results.append(SearchResult(chunk=chunk, score=round(score, 6)))

    results.sort(key=lambda item: (-item.score, item.chunk.path, item.chunk.heading))
    return results[: max(1, top_k)]


def detect_map_actions(question: str) -> list[AssistantAction]:
    text = normalize_text(question)
    actions: list[AssistantAction] = []

    if any(keyword in text for keyword in ("放大", "zoom in", "zoomin", "拉近")):
        actions.append(AssistantAction(type="zoom_in", label="放大地图"))
    if any(keyword in text for keyword in ("缩小", "zoom out", "zoomout", "拉远")):
        actions.append(AssistantAction(type="zoom_out", label="缩小地图"))

    style_keywords = [
        ("darkblue", ("极夜蓝", "深蓝", "darkblue")),
        ("dark", ("幻影黑", "黑色", "dark")),
        ("normal", ("标准", "普通", "normal", "默认")),
    ]
    for value, keywords in style_keywords:
        if any(keyword in text for keyword in keywords):
            actions.append(AssistantAction(type="set_map_style", label=f"切换底图：{_style_label(value)}", value=value))
            break

    return _dedupe_actions(actions)


def build_assistant_reply(
    question: str,
    chunks: list[AssistantChunk],
    top_k: int = 5,
) -> AssistantReply:
    results = retrieve_top_k(question, chunks, top_k=top_k)
    actions = detect_map_actions(question)

    if not results:
        answer = "我暂时没有在项目文档里找到直接对应的说明。可以换成 F1-F9 功能、接口、运行报错或地图操作来问。"
        return AssistantReply(answer=answer, sources=[], suggested_actions=actions, matched_chunks=[])

    answer_lines = _compose_answer(question, results)
    sources = [
        AssistantSource(
            title=result.chunk.title,
            path=result.chunk.path,
            heading=result.chunk.heading,
            score=result.score,
        )
        for result in results
    ]
    return AssistantReply(
        answer="\n".join(answer_lines),
        sources=sources,
        suggested_actions=actions,
        matched_chunks=[result.chunk for result in results],
    )


@lru_cache(maxsize=1)
def load_assistant_documents(docs_root: str | None = None) -> tuple[AssistantChunk, ...]:
    root = Path(docs_root).resolve() if docs_root else DEFAULT_DOCS_ROOT
    chunks: list[AssistantChunk] = []

    candidate_files = []
    readme_path = REPO_ROOT / "README.md"
    if readme_path.exists():
        candidate_files.append(readme_path)
    if root.exists():
        candidate_files.extend(sorted(root.rglob("*.md")))

    for file_path in candidate_files:
        if not _is_allowed_doc(file_path):
            continue
        try:
            text = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = file_path.read_text(encoding="utf-8-sig")
        relative_path = file_path.relative_to(REPO_ROOT).as_posix()
        chunks.extend(split_markdown_sections(relative_path, text))

    return tuple(chunks)


def _compose_answer(question: str, results: list[SearchResult]) -> list[str]:
    lead = results[0].chunk
    sentences = _select_relevant_sentences(question, lead.content, limit=3)
    if not sentences:
        sentences = [lead.content[:220].strip()]

    lines = [f"根据《{lead.title}》里的“{lead.heading}”，{sentences[0]}"]
    for sentence in sentences[1:]:
        lines.append(sentence)

    if len(results) > 1:
        related = "；".join(f"{item.chunk.heading}" for item in results[1:3])
        lines.append(f"相关文档还提到：{related}。")
    return lines


def _select_relevant_sentences(question: str, content: str, limit: int) -> list[str]:
    query_tokens = set(tokenize_text(question))
    parts = [
        part.strip(" -")
        for part in re.split(r"(?<=[。！？.!?])\s+|\n+|；|;", content)
        if part.strip(" -")
    ]
    scored: list[tuple[int, int, str]] = []
    for index, part in enumerate(parts):
        tokens = set(tokenize_text(part))
        overlap = len(query_tokens & tokens)
        if overlap > 0:
            scored.append((overlap, -index, part))

    if not scored:
        return [parts[0]] if parts else []

    scored.sort(reverse=True)
    selected = [item[2] for item in scored[:limit]]
    selected.sort(key=lambda sentence: parts.index(sentence))
    return selected


def _chunk_tokens(chunk: AssistantChunk) -> list[str]:
    return tokenize_text(f"{chunk.title} {chunk.heading} {chunk.heading} {chunk.content}")


def _asks_for_implementation_detail(question: str) -> bool:
    text = normalize_text(question)
    return any(
        keyword in text
        for keyword in (
            "代码逻辑",
            "具体逻辑",
            "实现逻辑",
            "算法逻辑",
            "怎么实现",
            "怎么算",
            "为什么可信",
            "如何计算",
            "怎么计算",
        )
    )


def _extract_feature_tokens(value: str) -> list[str]:
    return [match.group(0).lower() for match in FEATURE_TOKEN_RE.finditer(value.lower())]


def _is_implementation_logic_chunk(chunk: AssistantChunk) -> bool:
    text = normalize_text(f"{chunk.path} {chunk.title} {chunk.heading}")
    return (
        "f1-f9-code-logic" in text
        or "trajectory-logic" in text
        or "docs/05-technical-notes" in text
        or "technical-notes" in text
        or "代码逻辑" in text
        or "路径生成逻辑" in text
    )


def _extract_title(content: str) -> str | None:
    match = re.search(r"^#\s+(.+?)\s*$", content, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def _clean_markdown_text(content: str) -> str:
    text = re.sub(r"```.*?```", " ", content, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\|", "", text, flags=re.MULTILINE)
    return normalize_text(text)


def _is_allowed_doc(file_path: Path) -> bool:
    try:
        relative = file_path.relative_to(REPO_ROOT)
    except ValueError:
        return False
    first = relative.parts[0] if relative.parts else ""
    second = relative.parts[1] if len(relative.parts) > 1 else ""
    if relative.as_posix() == "README.md":
        return True
    return first == "docs" and second in DOC_PATH_ALLOWLIST and "work-notes" not in relative.parts


def _style_label(value: str) -> str:
    return {
        "darkblue": "极夜蓝",
        "dark": "幻影黑",
        "normal": "标准",
    }.get(value, value)


def _dedupe_actions(actions: list[AssistantAction]) -> list[AssistantAction]:
    seen: set[tuple[str, str | None]] = set()
    result: list[AssistantAction] = []
    for action in actions:
        key = (action.type, action.value)
        if key in seen:
            continue
        seen.add(key)
        result.append(action)
    return result
