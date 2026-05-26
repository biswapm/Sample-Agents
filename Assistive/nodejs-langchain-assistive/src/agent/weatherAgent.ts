import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { weatherLookupTool } from "../tools/weatherLookupTool.js";

const SYSTEM_PROMPT =
  "You are a helpful weather assistant. " +
  "You can look up current weather conditions for any city worldwide. " +
  "When asked about weather, always use the GetCurrentWeather tool to fetch live data. " +
  "Never say you are an AI or language model.";

function createLLM(opts: Record<string, unknown> = {}): ChatOpenAI | AzureChatOpenAI {
  if (process.env.AZURE_OPENAI_API_KEY) {
    return new AzureChatOpenAI({
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
      azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o",
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01",
      ...opts,
    });
  }
  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    ...opts,
  });
}

export class WeatherAgent {
  private llm: ReturnType<ReturnType<typeof createLLM>["bindTools"]>;
  private history: Map<string, (HumanMessage | AIMessage)[]>;

  constructor() {
    this.llm = createLLM({ temperature: 0.2 }).bindTools([weatherLookupTool]);
    this.history = new Map();
  }

  private getHistory(sessionId: string): (HumanMessage | AIMessage)[] {
    if (!this.history.has(sessionId)) this.history.set(sessionId, []);
    return this.history.get(sessionId)!;
  }

  async run(sessionId: string, userText: string): Promise<string> {
    const history = this.getHistory(sessionId);
    history.push(new HumanMessage(userText));

    const messages = [new SystemMessage(SYSTEM_PROMPT), ...history];

    while (true) {
      const response = await this.llm.invoke(messages);
      messages.push(response);

      if (!response.tool_calls?.length) {
        const text = typeof response.content === "string"
          ? response.content
          : (response.content as Array<{ text?: string }>).map(c => c.text ?? "").join("");
        history.push(new AIMessage(text));
        return text;
      }

      for (const toolCall of response.tool_calls) {
        const result = await weatherLookupTool.invoke(toolCall);
        messages.push(result);
      }
    }
  }
}
