"""Hợp đồng chat/RAG; không nhận role, actor hay tool từ trình duyệt."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=3000)


class AssistantQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=1000)
    language: Literal["vi", "en"] = "vi"
    consent: Literal[True]
    history: list[ChatMessage] = Field(default_factory=list, max_length=3)


class MaterialInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=160)
    topic_id: UUID
    content: str = Field(min_length=20, max_length=24000)
    student_visible: bool = False


class AssistantMaterial(BaseModel):
    id: str
    teacher_id: str
    topic_id: str
    title: str
    content: str
    student_visible: bool
    created_at: datetime


class AssistantSource(BaseModel):
    id: str
    title: str
    excerpt: str
    path: str
    kind: Literal["guide", "lesson"]


class AssistantAnswer(BaseModel):
    answer: str
    sources: list[AssistantSource] = Field(default_factory=list)
    mode: Literal["openai"] = "openai"
