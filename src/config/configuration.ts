import { ConfigService } from '@nestjs/config';

// Single source of truth for the Azure on/off gate (default: enabled).
export function isAzureEnabled(config: ConfigService): boolean {
  return config.get<boolean>('azure.enabled') ?? true;
}

export interface AppConfig {
  apiKey: string;
  azure: {
    enabled: boolean;
    key: string;
    region: string;
  };
  sdcv: {
    timeoutMs: number;
  };
  dictionariesConfigPath: string;
}

export default (): AppConfig => ({
  apiKey: process.env.API_KEY ?? '',
  azure: {
    enabled: process.env.AZURE_ENABLED !== 'false',
    key: process.env.AZURE_TRANSLATOR_KEY ?? '',
    region: process.env.AZURE_TRANSLATOR_REGION ?? '',
  },
  sdcv: {
    timeoutMs: parseInt(process.env.SDCV_TIMEOUT_MS ?? '3000', 10),
  },
  dictionariesConfigPath:
    process.env.DICTIONARIES_CONFIG_PATH ?? './config/dictionaries.json',
});
