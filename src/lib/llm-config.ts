import { LLMConfig, LLMProvider } from '@/types/llm';

/**
 * Get LLM configuration from environment variables
 * This provides secure, server-side configuration management
 */
export function getLLMConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;
  
  let apiKey: string | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;

  switch (provider) {
    case 'openai':
      apiKey = process.env.OPENAI_API_KEY;
      model = process.env.OPENAI_MODEL || 'gpt-4o';
      break;
    case 'claude':
      apiKey = process.env.CLAUDE_API_KEY;
      model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
      break;
    case 'local':
      apiKey = process.env.LOCAL_LLM_API_KEY; // Optional for local models
      model = process.env.LOCAL_MODEL || 'local-model';
      baseUrl = process.env.LOCAL_LLM_BASE_URL || 'http://localhost:1234';
      break;
  }

  const config: LLMConfig = {
    provider,
    apiKey,
    model,
    baseUrl,
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '4000')
  };

  return config;
}

/**
 * Check if LLM is properly configured
 */
export function isLLMConfigured(): boolean {
  const config = getLLMConfig();
  
  // For OpenAI and Claude, API key is required
  if (config.provider === 'openai' || config.provider === 'claude') {
    return !!config.apiKey;
  }
  
  // For local models, baseUrl is required, API key is optional
  if (config.provider === 'local') {
    return !!config.baseUrl;
  }
  
  return false;
}

/**
 * Get provider display name
 */
export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'openai': return 'OpenAI GPT';
    case 'claude': return 'Claude (Anthropic)';
    case 'local': return 'Local Model';
    default: return provider;
  }
}

/**
 * Get current LLM configuration status for display
 */
export function getLLMStatus() {
  const config = getLLMConfig();
  const isConfigured = isLLMConfigured();
  
  return {
    provider: config.provider,
    providerName: getProviderDisplayName(config.provider),
    model: config.model,
    isConfigured,
    hasApiKey: !!config.apiKey,
    temperature: config.temperature,
    maxTokens: config.maxTokens
  };
} 