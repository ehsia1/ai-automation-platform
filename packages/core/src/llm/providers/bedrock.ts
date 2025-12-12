import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
  type Tool as BedrockTool,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  LLMProvider,
  LLMMessage,
  LLMCompletionOptions,
  LLMCompletionWithToolsOptions,
  LLMToolResponse,
  ToolCall,
  ToolDefinition,
} from "./types";

export interface BedrockConfig {
  region?: string;
  model?: string;
}

/**
 * AWS Bedrock provider using the Converse API.
 * Works with Claude, Amazon Nova, Llama, Mistral, and other Bedrock models.
 * Uses AWS SDK credentials from the environment (IAM role in Lambda).
 */
export class BedrockProvider implements LLMProvider {
  private client: BedrockRuntimeClient;
  private model: string;

  constructor(config: BedrockConfig) {
    const region = config.region || process.env.AWS_REGION || "us-east-1";
    // Use Amazon Nova Pro by default - it's available without model agreements
    this.model = config.model || "amazon.nova-pro-v1:0";

    this.client = new BedrockRuntimeClient({ region });
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<string> {
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const input: ConverseCommandInput = {
      modelId: this.model,
      messages: this.convertMessages(nonSystemMessages),
      inferenceConfig: {
        maxTokens: options?.maxTokens ?? 2048,
      },
    };

    if (systemMessage?.content) {
      input.system = [{ text: systemMessage.content }];
    }

    const command = new ConverseCommand(input);
    const response = await this.client.send(command);

    // Extract text from response
    const content = response.output?.message?.content;
    if (!content || content.length === 0) {
      return "";
    }

    const textBlock = content.find((block) => "text" in block);
    return textBlock && "text" in textBlock ? textBlock.text || "" : "";
  }

  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMCompletionWithToolsOptions
  ): Promise<LLMToolResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const input: ConverseCommandInput = {
      modelId: this.model,
      messages: this.convertMessages(nonSystemMessages),
      inferenceConfig: {
        maxTokens: options?.maxTokens ?? 4096,
      },
    };

    if (systemMessage?.content) {
      input.system = [{ text: systemMessage.content }];
    }

    if (options?.tools && options.tools.length > 0) {
      input.toolConfig = this.convertToolConfig(options.tools);
    }

    const command = new ConverseCommand(input);
    const response = await this.client.send(command);

    return this.convertResponse(response);
  }

  private convertMessages(messages: LLMMessage[]): Message[] {
    const result: Message[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({
          role: "user",
          content: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const content: ContentBlock[] = [];

          if (msg.content) {
            content.push({ text: msg.content });
          }

          for (const tc of msg.tool_calls) {
            content.push({
              toolUse: {
                toolUseId: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              },
            });
          }

          result.push({
            role: "assistant",
            content,
          });
        } else {
          result.push({
            role: "assistant",
            content: [{ text: msg.content }],
          });
        }
      } else if (msg.role === "tool") {
        // Tool results go in a user message with toolResult blocks
        const lastMsg = result[result.length - 1];

        const toolResultBlock: ContentBlock = {
          toolResult: {
            toolUseId: msg.tool_call_id,
            content: [{ text: msg.content }],
          },
        };

        if (lastMsg && lastMsg.role === "user" && lastMsg.content) {
          (lastMsg.content as ContentBlock[]).push(toolResultBlock);
        } else {
          result.push({
            role: "user",
            content: [toolResultBlock],
          });
        }
      }
    }

    return result;
  }

  private convertToolConfig(tools: ToolDefinition[]): ToolConfiguration {
    const bedrockTools = tools.map((tool) => ({
      toolSpec: {
        name: tool.function.name,
        description: tool.function.description,
        inputSchema: {
          json: {
            type: "object",
            properties: tool.function.parameters.properties,
            required: tool.function.parameters.required,
          },
        },
      },
    }));

    return { tools: bedrockTools as unknown as BedrockTool[] };
  }

  private convertResponse(response: {
    output?: { message?: { content?: ContentBlock[] } };
    stopReason?: string;
  }): LLMToolResponse {
    const toolCalls: ToolCall[] = [];
    let textContent = "";

    const content = response.output?.message?.content || [];

    for (const block of content) {
      if ("text" in block && block.text) {
        textContent += block.text;
      } else if ("toolUse" in block && block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId || "",
          type: "function",
          function: {
            name: block.toolUse.name || "",
            arguments: JSON.stringify(block.toolUse.input),
          },
        });
      }
    }

    let finishReason: "stop" | "tool_calls" | "length" = "stop";
    if (response.stopReason === "tool_use") {
      finishReason = "tool_calls";
    } else if (response.stopReason === "max_tokens") {
      finishReason = "length";
    }

    return {
      content: textContent || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: finishReason,
    };
  }
}
