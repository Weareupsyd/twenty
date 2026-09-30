import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type DefaultAiCatalogService } from 'src/engine/metadata-modules/ai/ai-models/services/default-ai-catalog.service';
import { ProviderConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/provider-config.service';
import { type AiProvidersConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-providers-config.type';

describe('ProviderConfigService', () => {
  const catalog: AiProvidersConfig = {
    ollama: {
      npm: '@ai-sdk/openai-compatible',
      name: 'ollama',
      label: 'Ollama',
      baseUrl: '{{OLLAMA_BASE_URL}}',
      apiKey: '{{OLLAMA_API_KEY}}',
      models: [{ name: 'llama3.2', label: 'Llama 3.2' }],
    },
    openai: {
      npm: '@ai-sdk/openai',
      apiKey: '{{OPENAI_API_KEY}}',
      models: [{ name: 'gpt-4o', label: 'GPT-4o' }],
    },
  } as unknown as AiProvidersConfig;

  const createService = (customProviders: AiProvidersConfig) =>
    new ProviderConfigService(
      {
        get: (key: string) =>
          key === 'AI_PROVIDERS' ? customProviders : undefined,
      } as unknown as TwentyConfigService,
      {
        getDefaultAiCatalog: () => catalog,
      } as unknown as DefaultAiCatalogService,
    );

  it('keeps the local built-in Ollama connection above the custom-provider seat limit', () => {
    const service = createService({
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        name: 'ollama',
        label: 'Ollama',
        baseUrl: 'http://ollama:11434/v1',
        apiKey: 'ollama',
        models: [{ name: 'unapproved-model', label: 'Unapproved Model' }],
      },
      'private-gateway': {
        npm: '@ai-sdk/openai-compatible',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'secret',
        models: [{ name: 'gpt-4o', label: 'GPT-4o' }],
      },
    } as unknown as AiProvidersConfig);

    const providers = service.getResolvedProviders({
      includeCustomProviders: false,
    });

    expect(providers.ollama.baseUrl).toBe('http://ollama:11434/v1');
    expect(providers.ollama.apiKey).toBe('ollama');
    expect(providers.ollama.models?.map(({ name }) => name)).toEqual([
      'llama3.2',
    ]);
    expect(providers['private-gateway']).toBeUndefined();
  });

  it('does not exempt a remotely hosted Ollama endpoint from the custom-provider limit', () => {
    const service = createService({
      ollama: {
        npm: '@ai-sdk/openai-compatible',
        baseUrl: 'https://ollama.example.com/v1',
        apiKey: 'ollama',
      },
    } as unknown as AiProvidersConfig);

    const providers = service.getResolvedProviders({
      includeCustomProviders: false,
    });

    expect(providers.ollama.baseUrl).toBeUndefined();
    expect(providers.ollama.models).toEqual(catalog.ollama.models);
  });
});
