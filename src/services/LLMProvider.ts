import { 
  LLMConfig, 
  LLMMessage, 
  LLMResponse, 
  LLMToolCall, 
  LLMToolResult, 
  LLMTool 
} from '../types/llm';

export abstract class BaseLLMProvider {
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract generateResponse(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<LLMResponse>;

  abstract validateConfig(): Promise<boolean>;
}

export class OpenAIProvider extends BaseLLMProvider {
  async generateResponse(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const model = this.config.model || 'gpt-4o';
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4000;

    // Convert our message format to OpenAI format
    const openaiMessages = messages.map(msg => {
      if (msg.role === 'tool') {
        // Tool result message
        return {
          role: 'tool' as const,
          tool_call_id: msg.toolCallId!,
          content: msg.content
        };
      } else if (msg.toolCalls) {
        // Assistant message with tool calls
        return {
          role: msg.role,
          content: msg.content,
          tool_calls: msg.toolCalls.map(call => ({
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.parameters)
            }
          }))
        };
      }
      // Regular message
      return {
        role: msg.role,
        content: msg.content
      };
    });

    // Convert our tools format to OpenAI format
    const openaiTools = tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    const requestBody = {
      model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
      temperature,
      max_tokens: maxTokens
    };

    console.log('🚀 OpenAI Request:', {
      model,
      messageCount: openaiMessages.length,
      toolCount: openaiTools.length,
      hasTools: openaiTools.length > 0,
      temperature,
      max_tokens: maxTokens
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ OpenAI API Error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    console.log('📨 OpenAI Response:', {
      finishReason: choice.finish_reason,
      hasContent: !!choice.message.content,
      contentLength: choice.message.content?.length || 0,
      hasToolCalls: !!choice.message.tool_calls,
      toolCallCount: choice.message.tool_calls?.length || 0
    });

    // Convert response back to our format
    const responseMessage: LLMMessage = {
      role: 'assistant',
      content: choice.message.content || ''
    };

    if (choice.message.tool_calls) {
      responseMessage.toolCalls = choice.message.tool_calls.map((call: {
        id: string;
        function: { name: string; arguments: string };
      }) => ({
        id: call.id,
        name: call.function.name,
        parameters: JSON.parse(call.function.arguments)
      }));
    }

    return {
      message: responseMessage,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class ClaudeProvider extends BaseLLMProvider {
  async generateResponse(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('Claude API key is required');
    }

    const model = this.config.model || 'claude-3-5-sonnet-20241022';
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4000;

    // Extract system messages for Claude's separate system parameter
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
    
    // Convert our message format to Claude format (excluding system messages)
    const claudeMessages = nonSystemMessages.map(msg => {
      if (msg.role === 'tool') {
        // Tool result message
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId!,
              content: msg.content
            }
          ]
        };
      } else if (msg.toolCalls) {
        // Assistant message with tool calls
        return {
          role: msg.role,
          content: [
            { type: 'text', text: msg.content },
            ...msg.toolCalls.map(call => ({
              type: 'tool_use',
              id: call.id,
              name: call.name,
              input: call.parameters
            }))
          ]
        };
      }
      // Regular message
      return {
        role: msg.role,
        content: msg.content
      };
    });

    // Convert our tools format to Claude format
    const claudeTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));

    const requestBody = {
      model,
      messages: claudeMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined,
      temperature,
      max_tokens: maxTokens,
      // Claude requires system messages as a separate parameter
      ...(systemMessages.length > 0 && {
        system: systemMessages.map(msg => msg.content).join('\n\n')
      })
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Claude API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // Convert response back to our format
    const responseMessage: LLMMessage = {
      role: 'assistant',
      content: ''
    };

    const toolCalls: LLMToolCall[] = [];
    
    for (const content of data.content) {
      if (content.type === 'text') {
        responseMessage.content += content.text;
      } else if (content.type === 'tool_use') {
        toolCalls.push({
          id: content.id,
          name: content.name,
          parameters: content.input
        });
      }
    }

    if (toolCalls.length > 0) {
      responseMessage.toolCalls = toolCalls;
    }

    return {
      message: responseMessage,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      } : undefined
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      // Claude doesn't have a simple validation endpoint, so we'll make a minimal request
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class LocalLLMProvider extends BaseLLMProvider {
  async generateResponse(
    messages: LLMMessage[],
    tools: LLMTool[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    if (!this.config.baseUrl) {
      throw new Error('Base URL is required for local LLM provider');
    }

    const temperature = options?.temperature ?? this.config.temperature ?? 0.7;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4000;

    // Use OpenAI-compatible format for local models
    const requestBody = {
      model: this.config.model || 'local-model',
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      temperature,
      max_tokens: maxTokens
    };

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Local LLM API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      message: {
        role: 'assistant',
        content: choice.message.content || ''
      },
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0
      } : undefined
    };
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.baseUrl) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        headers: {
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class LLMProviderFactory {
  static create(config: LLMConfig): BaseLLMProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'claude':
        return new ClaudeProvider(config);
      case 'local':
        return new LocalLLMProvider(config);
      default:
        throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
  }
}

// Helper function to execute tool calls
export async function executeToolCalls(
  toolCalls: LLMToolCall[],
  availableTools: LLMTool[]
): Promise<LLMToolResult[]> {
  const results: LLMToolResult[] = [];

  for (const toolCall of toolCalls) {
    const tool = availableTools.find(t => t.name === toolCall.name);
    
    if (!tool) {
      results.push({
        toolCallId: toolCall.id,
        result: null,
        error: `Tool '${toolCall.name}' not found`
      });
      continue;
    }

    try {
      const result = await tool.handler(toolCall.parameters);
      results.push({
        toolCallId: toolCall.id,
        result
      });
    } catch (error) {
      results.push({
        toolCallId: toolCall.id,
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
} 