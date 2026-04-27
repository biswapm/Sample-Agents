# Autonomous Weather Agents — Sample Agents

Three autonomous weather agents built with different stacks, all sharing the same Azure OpenAI backend. Each agent:
- Exposes a **chat endpoint** (`POST /api/chat`) for on-demand weather queries
- Runs a **background weather monitor** that polls Open-Meteo every 60 seconds and generates an AI advisory

---

## Prerequisites

| Requirement | Version |
|---|---|
| Azure OpenAI resource | with a deployed model (e.g. `gpt-4o`) |
| .NET SDK | 8.0+ (for .NET agent) |
| Node.js | 20+ (for Node.js agent) |
| Python | 3.11+ (for Python agent) |
| `uv` (Python package manager) | any recent version |

---

## Azure OpenAI Configuration

All three agents use the same Azure OpenAI values. Replace the placeholders below with your own:

| Key | Description |
|---|---|
| `Endpoint` | Your Azure OpenAI resource URL |
| `ApiKey` | Your Azure OpenAI API key |
| `Deployment` | Your deployed model name (e.g. `gpt-4o`) |
| `ApiVersion` | API version (e.g. `2024-12-01-preview`) |

---

## 1. .NET Agent (AgentFramework)

**Stack:** C# · .NET 8 · Microsoft AgentFramework · Azure OpenAI SDK

### Setup

1. Open `dotent-agentframework-auto/appsettings.json`
2. Fill in the `AzureOpenAI` section:
   ```json
   "AzureOpenAI": {
     "Endpoint": "https://<your-resource>.cognitiveservices.azure.com/",
     "ApiKey": "<your-api-key>",
     "Deployment": "<your-deployment-name>",
     "ApiVersion": "2024-12-01-preview"
   }
   ```

### Run

```bash
cd dotent-agentframework-auto
dotnet run
```

Server starts on **http://localhost:3978**

### Test

```bash
curl -X POST http://localhost:3978/api/messages \
  -H "Content-Type: application/json" \
  -d '{"type":"message","text":"What is the weather in London?"}'
```

---

## 2. Node.js Agent (LangChain + TypeScript)

**Stack:** Node.js · TypeScript · LangChain · Azure OpenAI

### Setup

1. Copy `.env.example` to `.env` inside `nodejs-langchain-auto/`:
   ```bash
   cp nodejs-langchain-auto/.env.example nodejs-langchain-auto/.env
   ```
2. Edit `.env` and fill in:
   ```env
   AZURE_OPENAI_API_KEY=<your-api-key>
   AZURE_OPENAI_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com/
   AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>
   AZURE_OPENAI_API_VERSION=2024-12-01-preview
   ```

### Run

```bash
cd nodejs-langchain-auto
npm install
npm start
```

Server starts on **http://localhost:3978**

### Test

```bash
curl -X POST http://localhost:3978/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?", "sessionId": "user1"}'
```

### Dev mode (auto-reload on file changes)

```bash
npm run dev
```

---

## 3. Python Agent (OpenAI SDK + FastAPI)

**Stack:** Python · FastAPI · OpenAI SDK · uv

### Setup

1. Copy `.env.example` to `.env` inside `python-openai-auto/`:
   ```bash
   cp python-openai-auto/.env.example python-openai-auto/.env
   ```
2. Edit `.env` and fill in:
   ```env
   AZURE_OPENAI_API_KEY=<your-api-key>
   AZURE_OPENAI_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com/
   AZURE_OPENAI_DEPLOYMENT=<your-deployment-name>
   AZURE_OPENAI_API_VERSION=2024-12-01-preview
   ```

### Run

```bash
cd python-openai-auto
uv sync
uv run python main.py
```

Server starts on **http://localhost:3978**

### Test

```bash
curl -X POST http://localhost:3978/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Paris?", "sessionId": "user1"}'
```

### Health check

```bash
curl http://localhost:3978/api/health
```

---

## Folder Structure

```
Autonomous/
├── README.md                        ← you are here
├── dotent-agentframework-auto/      ← .NET C# agent
│   ├── Agent/WeatherAgentApp.cs
│   ├── Tools/WeatherLookupTool.cs
│   ├── WeatherMonitorService.cs
│   ├── appsettings.json             ← set AzureOpenAI config here
│   └── WeatherAgent.csproj
├── nodejs-langchain-auto/           ← Node.js TypeScript agent
│   ├── src/
│   │   ├── index.ts
│   │   ├── agent/weatherAgent.ts
│   │   ├── tools/weatherLookupTool.ts
│   │   └── services/weatherMonitorService.ts
│   ├── .env                         ← set AzureOpenAI config here
│   ├── tsconfig.json
│   └── package.json
└── python-openai-auto/              ← Python FastAPI agent
    ├── agent/weather_agent.py
    ├── tools/weather_lookup.py
    ├── services/weather_monitor.py
    ├── main.py
    ├── .env                         ← set AzureOpenAI config here
    └── pyproject.toml
```

---

## Notes

- All agents use the free [Open-Meteo API](https://open-meteo.com/) for weather data — no API key required.
- Only **one agent should run at a time** on port `3978`, or change the `PORT` env variable to run them in parallel.
- The background monitor fires immediately on startup, then every 60 seconds (configurable via `HEARTBEAT_INTERVAL_MS`).
