import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.weather_agent import WeatherAgent
from services.weather_monitor import WeatherMonitorService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

weather_agent = WeatherAgent()
monitor = WeatherMonitorService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await monitor.start()
    yield
    await monitor.stop()


app = FastAPI(title="Python OpenAI Weather Agent", lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


@app.get("/api/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    response = await weather_agent.run(req.session_id, req.message)
    return {"response": response}


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    async def generate():
        async for chunk in weather_agent.run_streaming(req.session_id, req.message):
            yield chunk

    return StreamingResponse(generate(), media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "3978"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
