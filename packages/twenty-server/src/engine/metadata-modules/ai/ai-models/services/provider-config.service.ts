import { Injectable } from '@nestjs/common';

import { type ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AI_SDK_OPENAI_COMPATIBLE } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import { DefaultAiCatalogService } from 'src/engine/metadata-modules/ai/ai-models/services/default-ai-catalog.service';

import { type AiProviderConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-provider-config.type';
import { type AiProvidersConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-providers-config.type';
import { extractConfigVariableName } from 'src/engine/metadata-modules/ai/ai-models/utils/extract-config-variable-name.util';
import { mergeCustomProvidersIntoCatalog } from 'src/engine/metadata-modules/ai/ai-models/utils/merge-custom-providers-into-catalog.util';

const isLocalOllamaUrl = (baseUrl?: string): boolean => {
  if (!baseUrl) {
    return false;
  }

  try {
    const url = new URL(baseUrl);

    return (
      url.protocol === 'http:' &&
      ['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

@Injectable()
export class ProviderConfigService {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly defaultAiCatalogService: DefaultAiCatalogService,
  ) {}

  getCatalogProviderNames(): Set<string> {
    return new Set(
      Object.keys(this.defaultAiCatalogService.getDefaultAiCatalog()),
    );
  }

  getResolvedProviders({
    includeCustomProviders = true,
  }: { includeCustomProviders?: boolean } = {}): AiProvidersConfig {
    const rawCatalog = this.defaultAiCatalogService.getDefaultAiCatalog();
    // Only resolve {{VAR}} templates in the committed catalog — never in
    // user-supplied custom providers, to prevent config variable exfiltration.
    const catalog = this.resolveTemplates(rawCatalog);

    const customProviders = this.twentyConfigService.get('AI_PROVIDERS');

    if (!includeCustomProviders) {
      // Ollama is also a first-party local catalog provider. Keep its local
      // connection settings available above the custom-provider seat limit,
      // but only for the bundled provider/model list and a local Docker/loopback
      // endpoint. Other custom providers and user-added Ollama models stay
      // subject to the Organization entitlement.
      const ollamaOverride = customProviders.ollama;

      if (
        !catalog.ollama?.models?.length ||
        ollamaOverride?.npm !== AI_SDK_OPENAI_COMPATIBLE ||
        !isLocalOllamaUrl(ollamaOverride.baseUrl)
      ) {
        return catalog;
      }

      const localOllamaConfig = { ...ollamaOverride };
      delete localOllamaConfig.models;

      return mergeCustomProvidersIntoCatalog({
        catalog,
        custom: { ollama: localOllamaConfig },
      });
    }

    return mergeCustomProvidersIntoCatalog({
      catalog,
      custom: customProviders,
    });
  }

  private resolveTemplates(providers: AiProvidersConfig): AiProvidersConfig {
    const result: AiProvidersConfig = {};

    for (const [name, config] of Object.entries(providers)) {
      result[name] = this.resolveProviderTemplates(config);
    }

    return result;
  }

  private resolveProviderTemplates(config: AiProviderConfig): AiProviderConfig {
    return {
      ...config,
      baseUrl: this.resolveTemplate(config.baseUrl),
      apiKey: this.resolveTemplate(config.apiKey),
      accessKeyId: this.resolveTemplate(config.accessKeyId),
      secretAccessKey: this.resolveTemplate(config.secretAccessKey),
    };
  }

  private resolveTemplate(value?: string): string | undefined {
    if (!value) {
      return value;
    }

    const varName = extractConfigVariableName(value);

    if (!varName) {
      return value;
    }

    // Registered config variables first (supports admin panel / DB overrides),
    // then fall back to process.env for vars not in ConfigVariables
    // (e.g. when CI replaces the catalog with custom provider entries).
    try {
      const resolved = this.twentyConfigService.get(
        varName as keyof ConfigVariables,
      ) as string | undefined;

      if (resolved) {
        return resolved;
      }
    } catch {
      // Not a registered config variable — fall through to env
    }

    return process.env[varName] || undefined;
  }
}
