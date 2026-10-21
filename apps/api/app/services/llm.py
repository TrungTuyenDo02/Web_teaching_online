"""Gateway OpenAI duy nhất; không log nội dung, không retry tự động gây nhân chi phí."""

import httpx

from app.config import Settings


class LLMUnavailable(Exception):
    pass


async def respond(
    settings: Settings, *, instructions: str, messages: list[dict], tools: list[dict] | None = None
) -> dict:
    payload = {
        "model": settings.openai_chat_model,
        "instructions": instructions,
        "input": messages,
        "store": False,
        "include": ["reasoning.encrypted_content"],
        "max_output_tokens": min(max(settings.assistant_max_output_tokens, 128), 2000),
    }
    if tools:
        payload.update(tools=tools, tool_choice="required", parallel_tool_calls=False)
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            result = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json=payload,
            )
            result.raise_for_status()
            data = result.json()
        if data.get("status") != "completed" or not isinstance(data.get("output"), list):
            raise LLMUnavailable
        return data
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise LLMUnavailable from exc


def text_of(response: dict) -> str:
    text = "\n".join(
        part["text"]
        for item in response["output"]
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text" and isinstance(part.get("text"), str)
    )
    if not text.strip() or len(text) > 12000:
        raise LLMUnavailable
    return text.strip()
