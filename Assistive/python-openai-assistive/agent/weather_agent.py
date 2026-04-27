import json
import os
from openai import AsyncOpenAI, AsyncAzureOpenAI

from tools.weather_lookup import get_current_weather, WEATHER_TOOL_SCHEMA

SYSTEM_PROMPT = (
    "You are a helpful weather assistant. "
    "You can look up current weather conditions for any city worldwide. "
    "When asked about weather, always use the get_current_weather tool to fetch live data. "
    "Never say you are an AI or language model."
)


def _create_client() -> AsyncOpenAI:
    if os.environ.get("AZURE_OPENAI_API_KEY"):
        return AsyncAzureOpenAI(
            api_key=os.environ["AZURE_OPENAI_API_KEY"],
            azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-01"),
        )
    return AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])


def _model_name() -> str:
    if os.environ.get("AZURE_OPENAI_API_KEY"):
        return os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    return os.environ.get("OPENAI_MODEL", "gpt-4o")


class WeatherAgent:
    def __init__(self) -> None:
        self.client = _create_client()
        self.model = _model_name()
        self._history: dict[str, list[dict]] = {}

    def _get_history(self, session_id: str) -> list[dict]:
        if session_id not in self._history:
            self._history[session_id] = []
        return self._history[session_id]

    async def run(self, session_id: str, user_text: str) -> str:
        history = self._get_history(session_id)
        history.append({"role": "user", "content": user_text})

        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

        while True:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=[WEATHER_TOOL_SCHEMA],
                temperature=0.2,
            )

            message = response.choices[0].message
            messages.append(message.model_dump(exclude_none=True))

            if not message.tool_calls:
                reply = message.content or ""
                history.append({"role": "assistant", "content": reply})
                return reply

            for tool_call in message.tool_calls:
                if tool_call.function.name == "get_current_weather":
                    args = json.loads(tool_call.function.arguments)
                    result = await get_current_weather(args["city"])
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    })

    async def run_streaming(self, session_id: str, user_text: str):
        history = self._get_history(session_id)
        history.append({"role": "user", "content": user_text})

        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

        while True:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=[WEATHER_TOOL_SCHEMA],
                temperature=0.2,
            )

            message = response.choices[0].message
            messages.append(message.model_dump(exclude_none=True))

            if not message.tool_calls:
                break

            for tool_call in message.tool_calls:
                if tool_call.function.name == "get_current_weather":
                    args = json.loads(tool_call.function.arguments)
                    result = await get_current_weather(args["city"])
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    })

        full_reply = ""
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.2,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                full_reply += delta
                yield delta

        history.append({"role": "assistant", "content": full_reply})
