import httpx
from datetime import datetime, timezone
from urllib.parse import quote

WMO_DESCRIPTIONS: dict[int, str] = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "icy fog", 51: "light drizzle", 61: "light rain",
    63: "moderate rain", 71: "light snow", 80: "rain showers", 95: "thunderstorm",
}

# OpenAI function schema for this tool
WEATHER_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_current_weather",
        "description": "Get current weather conditions for any city worldwide",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "The name of the city, e.g. 'Chennai', 'Seattle', 'London'",
                }
            },
            "required": ["city"],
        },
    },
}


async def get_current_weather(city: str) -> str:
    async with httpx.AsyncClient() as client:
        # Geocode city name to lat/lon via Open-Meteo (no API key required)
        geo_res = await client.get(
            f"https://geocoding-api.open-meteo.com/v1/search?name={quote(city)}&count=1"
        )
        geo_data = geo_res.json()
        results = geo_data.get("results", [])
        if not results:
            return f"City '{city}' not found. Check spelling or try a nearby major city."

        first = results[0]
        lat = first["latitude"]
        lon = first["longitude"]
        name = first.get("name", city)
        country = first.get("country", "")
        location = f"{name}, {country}" if country else name

        weather_res = await client.get(
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m"
            f"&temperature_unit=fahrenheit"
        )
        current = weather_res.json()["current"]

        temp = current["temperature_2m"]
        code = current["weather_code"]
        wind = current["wind_speed_10m"]
        humidity = current["relative_humidity_2m"]
        description = WMO_DESCRIPTIONS.get(code, f"weather code {code}")
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M") + " UTC"

        return (
            f"Current weather in {location} at {timestamp}: "
            f"{temp:.1f}°F, {description}, wind {wind:.1f} mph, humidity {humidity:.0f}%."
        )
