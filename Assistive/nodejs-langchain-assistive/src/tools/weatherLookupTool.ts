import { tool } from "@langchain/core/tools";
import { z } from "zod";
import axios from "axios";

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "icy fog", 51: "light drizzle", 61: "light rain",
  63: "moderate rain", 71: "light snow", 80: "rain showers", 95: "thunderstorm",
};

export const weatherLookupTool = tool(
  async ({ city }: { city: string }): Promise<string> => {
    const geoRes = await axios.get<{ results?: Array<{ latitude: number; longitude: number; name: string; country?: string }> }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    );
    const results = geoRes.data?.results;
    if (!results?.length) return `City '${city}' not found. Check spelling or try a nearby major city.`;

    const { latitude: lat, longitude: lon, name, country } = results[0];
    const location = country ? `${name}, ${country}` : name;

    const weatherRes = await axios.get<{ current: { temperature_2m: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number } }>(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&temperature_unit=fahrenheit`
    );

    const { temperature_2m: temp, weather_code: code, wind_speed_10m: wind, relative_humidity_2m: humidity } = weatherRes.data.current;
    const description = WMO_DESCRIPTIONS[code] ?? `weather code ${code}`;
    const timestamp = new Date().toISOString().slice(0, 16) + " UTC";

    return `Current weather in ${location} at ${timestamp}: ${temp.toFixed(1)}°F, ${description}, wind ${wind.toFixed(1)} mph, humidity ${humidity}%.`;
  },
  {
    name: "GetCurrentWeather",
    description: "Get current weather conditions for any city worldwide",
    schema: z.object({
      city: z.string().describe("The name of the city, e.g. 'Chennai', 'Seattle', 'London'"),
    }),
  }
);
