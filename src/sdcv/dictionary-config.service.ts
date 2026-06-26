import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DefinitionFormat } from './definition-parser';

export interface DictionaryConfig {
  dictName: string; // sdcv -u argument
  path: string; // directory containing the .ifo/.idx/.dict files
  format: DefinitionFormat; // derived from the .ifo sametypesequence
}

// As loaded from dictionaries.json (format is resolved at startup, not authored).
type RawDictionaryConfig = Omit<DictionaryConfig, 'format'>;

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
      const parsed = JSON.parse(raw) as Record<string, RawDictionaryConfig>;
      this.configs = Object.fromEntries(
        Object.entries(parsed).map(([pair, cfg]) => [
          pair,
          { ...cfg, format: this.detectFormat(cfg.path) },
        ]),
      );
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

  // Reads the dict's .ifo sametypesequence: 'h' (and other markup types) → html,
  // everything else → plain text. Falls back to 'text' if the .ifo is unreadable.
  private detectFormat(dictPath: string): DefinitionFormat {
    try {
      const dir = resolve(dictPath);
      const ifo = readdirSync(dir).find((f) => f.endsWith('.ifo'));
      if (!ifo) {
        return 'text';
      }
      const seq = /sametypesequence=(\S+)/.exec(
        readFileSync(resolve(dir, ifo), 'utf-8'),
      )?.[1];
      return seq?.includes('h') ? 'html' : 'text';
    } catch {
      this.logger.warn(
        `Could not read .ifo for ${dictPath}; assuming plain-text definitions.`,
      );
      return 'text';
    }
  }
}
