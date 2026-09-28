import { AI_SDK_OPENAI_COMPATIBLE } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import { type AiProviderConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-provider-config.type';

export const isProviderConfigured = (config: AiProviderConfig): boolean => {
  // Local OpenAI-compatible servers such as Ollama are configured by URL.
  // They often have no API key.
  if (config.npm === AI_SDK_OPENAI_COMPATIBLE) {
    return Boolean(config.baseUrl);
  }

  return Boolean(config.apiKey || config.accessKeyId || config.authType);
};
