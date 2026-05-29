import "dotenv/config";
import express, { Request, Response } from "express";
import { TravelAgent } from "./agent/travelAgent.js";

const app = express();
app.use(express.json());

const agent = new TravelAgent();

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

const port = parseInt(process.env.PORT ?? "3978", 10);
app.listen(port, () => {
  console.log(`TravelAgent running on http://localhost:${port}`);
});
