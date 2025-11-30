import type { LLMProvider, LLMMessage, LLMCompletionOptions } from "./types";

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "claude-3-haiku-20240307";
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<string> {
    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 2048,
        system: systemMessage?.content,
        messages: nonSystemMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textContent = data.content.find((c) => c.type === "text");
    return textContent?.text || "";
  }
}
