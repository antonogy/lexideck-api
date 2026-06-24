import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface DictionaryConfig {
  dictName: string; // sdcv -u argument
  path: string; // directory containing the .ifo/.idx/.dict files
}

@Injectable()
export class DictionaryConfigService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryConfigService.name);
  private configs: Record<string, DictionaryConfig> = {};

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const path = resolve(
      this.config.get<string>('dictionariesConfigPath') ??
        './config/dictionaries.json',
    );
    try {
      const raw = readFileSync(path, 'utf-8');
      this.configs = JSON.parse(raw) as Record<string, DictionaryConfig>;
      this.logger.log(
        `Loaded ${Object.keys(this.configs).length} dictionary pair(s) from ${path}`,
      );
    } catch (err) {
      // Missing/empty config is valid — all lookups fall through to Azure.
      this.logger.warn(
        `Could not load dictionaries config at ${path}: ${(err as Error).message}. Continuing with no local dictionaries.`,
      );
      this.configs = {};
    }
  }

  getConfig(from: string, to: string): DictionaryConfig | null {
    return this.configs[`${from}-${to}`] ?? null;
  }
}
