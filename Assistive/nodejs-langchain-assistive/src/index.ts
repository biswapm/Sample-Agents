import "dotenv/config";
import express, { Request, Response } from "express";
import { WeatherAgent } from "./agent/weatherAgent.js";

const app = express();
app.use(express.json());

const agent = new WeatherAgent();

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, sessionId = "default" } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message is required" }) as unknown as void;

  try {
    const response = await agent.run(sessionId as string, message as string);
    res.json({ response });
  } catch (err) {
    console.error("[Chat] Error:", (err as Error).message);
    res.status(500).json({ error: "Internal server error" });
  }
});

const port = parseInt(process.env.PORT ?? "3980", 10);
app.listen(port, () => {
  console.log(`nodejs-langchain-assistive-weather-agent running on http://localhost:${port}`);
});
