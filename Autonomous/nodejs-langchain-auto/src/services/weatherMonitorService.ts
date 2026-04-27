import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import axios from "axios";

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "icy fog", 51: "light drizzle", 61: "light rain",
  63: "moderate rain", 71: "light snow", 80: "rain showers", 95: "thunderstorm",
};

function createLLM(): ChatOpenAI | AzureChatOpenAI {
  if (process.env.AZURE_OPENAI_API_KEY) {
    return new AzureChatOpenAI({
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
      temperature: 0.2,
    });
  }
  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0.2,
  });
}

interface CurrentWeather {
  temperature_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  relative_humidity_2m: number;
}

export class WeatherMonitorService {
  private readonly intervalMs: number;
  private readonly city: string;
  private readonly lat: string;
  private readonly lon: string;
  private readonly llm: ChatOpenAI | AzureChatOpenAI;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.intervalMs = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "60000", 10);
    this.city = process.env.WEATHER_MONITOR_CITY ?? "Seattle, WA";
    this.lat = process.env.WEATHER_MONITOR_LATITUDE ?? "47.6062";
    this.lon = process.env.WEATHER_MONITOR_LONGITUDE ?? "-122.3321";
    this.llm = createLLM();
  }

  start(): void {
    console.log(`[WeatherMonitor] Started for ${this.city}. Interval: ${this.intervalMs}ms`);
    this.runCycle();
    this.timer = setInterval(() => this.runCycle(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(): Promise<void> {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${this.lat}&longitude=${this.lon}` +
        `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
        `&temperature_unit=fahrenheit`;

      const res = await axios.get<{ current: CurrentWeather }>(url);
      const { temperature_2m: temp, weather_code: code, wind_speed_10m: wind, relative_humidity_2m: humidity } = res.data.current;
      const description = WMO_DESCRIPTIONS[code] ?? `code ${code}`;
      const timestamp = new Date().toISOString().slice(0, 16) + " UTC";

      console.log(`[WeatherMonitor] ${this.city}: ${temp}°F, ${description}, wind ${wind}mph, humidity ${humidity}%`);

      const response = await this.llm.invoke([
        new SystemMessage(
          "You are an autonomous field operations agent monitoring weather conditions. " +
          "Never say you are an AI or language model."
        ),
        new HumanMessage(
          `Conditions in ${this.city} at ${timestamp}: ${temp}°F, ${description}, ` +
          `wind ${wind}mph, humidity ${humidity}%. ` +
          "In one sentence, assess conditions and advise whether field operations " +
          "should proceed normally, with caution, or be postponed."
        ),
      ]);

      const advisory = typeof response.content === "string"
        ? response.content
        : (response.content as Array<{ text?: string }>).map(c => c.text ?? "").join("");

      console.log(`[WeatherMonitor] Advisory: ${advisory}`);
    } catch (err) {
      console.error(`[WeatherMonitor] Error:`, (err as Error).message);
    }
  }
}
