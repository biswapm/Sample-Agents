# Assistive Weather Agents

Three equivalent assistive weather agents — one per stack — that respond to chat messages with live weather data. Unlike the Autonomous agents, **there is no background monitor service**; the agent only acts when a user sends a message.

| Agent | Stack | Default Port | Chat Endpoint |
|-------|-------|-------------|---------------|
| `python-openai-assistive` | Python + FastAPI + OpenAI SDK | `3979` | `POST /api/chat` |
| `nodejs-langchain-assistive` | Node.js + TypeScript + LangChain | `3980` | `POST /api/chat` |
| `dotnet-agentframework-assistive` | C# + ASP.NET Core + Microsoft Agents | `3981` | `POST /api/messages` |

---

## Prerequisites

| Tool | Min Version |
|------|-------------|
| Python | 3.11+ |
| Node.js | 20+ |
| .NET SDK | 8.0+ |
| Azure OpenAI resource | — |

---

## Clone

```bash
git clone <repo-url>
cd Sample-Agents/Assistive
```

---

## Python — `python-openai-assistive`

### Setup

```bash
cd python-openai-assistive

# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux

# Install dependencies
pip install -e .

# Configure environment
copy .env.example .env
# Edit .env and set your Azure OpenAI or OpenAI credentials
```

**.env** (Azure OpenAI):
```
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-12-01-preview
PORT=3979
```

### Run

```bash
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 3979
```

### Test

**Health check:**
```bash
curl http://localhost:3979/api/health
```

**Chat:**
```bash
curl -X POST http://localhost:3979/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in Tokyo?", "session_id": "user1"}'
```

**Streaming chat:**
```bash
curl -X POST http://localhost:3979/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "How about Paris?", "session_id": "user1"}'
```

**Multi-turn conversation:**
```bash
curl -X POST http://localhost:3979/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Compare that to Mumbai.", "session_id": "user1"}'
```

---

## Node.js — `nodejs-langchain-assistive`

### Setup

```bash
cd nodejs-langchain-assistive

npm install

copy .env.example .env
# Edit .env and set your Azure OpenAI or OpenAI credentials
```

**.env** (Azure OpenAI):
```
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-12-01-preview
PORT=3980
```

### Run

```bash
npm start
# or for watch mode (auto-restart on save)
npm run dev
```

### Test

**Health check:**
```bash
curl http://localhost:3980/api/health
```

**Chat:**
```bash
curl -X POST http://localhost:3980/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in London?", "sessionId": "user1"}'
```

**Multi-turn:**
```bash
curl -X POST http://localhost:3980/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "And in Berlin?", "sessionId": "user1"}'
```

---

## .NET — `dotnet-agentframework-assistive`

### Setup

```bash
cd dotnet-agentframework-assistive

# Edit appsettings.json and set your Azure OpenAI credentials
# Update: AzureOpenAI:Endpoint, AzureOpenAI:ApiKey, AzureOpenAI:Deployment
```

**appsettings.json** (key section):
```json
"AzureOpenAI": {
  "Endpoint": "https://your-resource.cognitiveservices.azure.com/",
  "ApiKey": "your-api-key",
  "Deployment": "gpt-4o",
  "ApiVersion": "2024-12-01-preview"
}
```

### Run

```bash
dotnet run
```

The server starts on `http://localhost:3981` (set `PORT` in appsettings.json to change).

### Test

**Health check:**
```bash
curl http://localhost:3981/api/health
```

The `/api/messages` endpoint follows the Microsoft Bot Framework Activity protocol and is designed for connection via Azure Agent Service or Bot Framework Emulator. To test interactively, use **Bot Framework Emulator**:

1. Download [Bot Framework Emulator](https://github.com/microsoft/BotFramework-Emulator/releases)
2. Open the emulator → **Open Bot**
3. Set Bot URL to `http://localhost:3981/api/messages`
4. Click **Connect**
5. Type any weather question, e.g. `What is the weather in Chennai?`

---

## Key Differences: Assistive vs Autonomous

| Feature | Assistive | Autonomous |
|---------|-----------|------------|
| Responds to user chat | Yes | Yes |
| Background weather monitor | **No** | Yes |
| Heartbeat/advisory loop | **No** | Yes |
| `WeatherMonitorService` | **Not present** | Present |
| Startup complexity | Minimal | Requires monitor config |

---

## Environment Variables Reference

| Variable | Used by | Default | Description |
|----------|---------|---------|-------------|
| `AZURE_OPENAI_API_KEY` | Python, Node.js | — | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | Python, Node.js | — | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Python, Node.js | `gpt-4o` | Model deployment name |
| `AZURE_OPENAI_API_VERSION` | Python, Node.js | `2024-02-01` | API version |
| `OPENAI_API_KEY` | Python, Node.js | — | OpenAI key (alternative to Azure) |
| `OPENAI_MODEL` | Python, Node.js | `gpt-4o` | Model name (standard OpenAI only) |
| `PORT` | Python, Node.js | `3979`/`3980` | Server listen port |

For .NET, all configuration is in `appsettings.json`.
