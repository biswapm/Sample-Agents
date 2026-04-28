import asyncio
import logging
import os

import httpx
from datetime import datetime, timezone
from openai import AsyncOpenAI, AsyncAzureOpenAI

logger = logging.getLogger(__name__)

WMO_DESCRIPTIONS: dict[int, str] = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "icy fog", 51: "light drizzle", 61: "light rain",
    63: "moderate rain", 71: "light snow", 80: "rain showers", 95: "thunderstorm",
}


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


class WeatherMonitorService:
    def __init__(self) -> None:
        interval_ms = int(os.environ.get("HEARTBEAT_INTERVAL_MS", "60000"))
        self.interval = interval_ms / 1000.0
        self.city = os.environ.get("WEATHER_MONITOR_CITY", "Seattle, WA")
        self.lat = os.environ.get("WEATHER_MONITOR_LATITUDE", "47.6062")
        self.lon = os.environ.get("WEATHER_MONITOR_LONGITUDE", "-122.3321")
        self.client = _create_client()
        self.model = _model_name()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        logger.info("WeatherMonitorService started for %s. Interval: %ss", self.city, self.interval)
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while True:
            await self._cycle()
            await asyncio.sleep(self.interval)

    async def _cycle(self) -> None:
        try:
            url = (
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={self.lat}&longitude={self.lon}"
                f"&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m"
                f"&temperature_unit=fahrenheit"
            )
            async with httpx.AsyncClient() as http:
                res = await http.get(url)
                data = res.json()

            current = data["current"]
            temp = current["temperature_2m"]
            code = current["weather_code"]
            wind = current["wind_speed_10m"]
            humidity = current["relative_humidity_2m"]
            description = WMO_DESCRIPTIONS.get(code, f"code {code}")
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M") + " UTC"

            logger.info(
                "Weather in %s: %.1f°F, %s, wind %.1f mph, humidity %.0f%%",
                self.city, temp, description, wind, humidity,
            )

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an autonomous field operations agent monitoring weather conditions. "
                            "Never say you are an AI or language model."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Conditions in {self.city} at {timestamp}: {temp:.1f}°F, {description}, "
                            f"wind {wind:.1f}mph, humidity {humidity:.0f}%. "
                            "In one sentence, assess conditions and advise whether field operations "
                            "should proceed normally, with caution, or be postponed."
                        ),
                    },
                ],
                temperature=0.2,
            )

            advisory = response.choices[0].message.content
            logger.info("Advisory: %s", advisory)

        except Exception as exc:
            logger.error("WeatherMonitorService error: %s", exc)
