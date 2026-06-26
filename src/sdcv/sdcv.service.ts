import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import { InternalTranslationResult } from '../translate/dto/translation-result.dto';
import { parseDefinition } from './definition-parser';
import { DictionaryConfig } from './dictionary-config.service';
import { dedupeAlternatives } from './merge';

const execFileAsync = promisify(execFile);

interface SdcvEntry {
  dict: string;
  word: string;
  definition: string;
}

@Injectable()
export class SdcvService {
  constructor(private readonly config: ConfigService) {}

  // Returns parsed result, or null if "not found"/empty.
  // Throws BadGatewayException (→ 502) on process error, timeout, or malformed JSON.
  async lookup(
    text: string,
    config: DictionaryConfig,
  ): Promise<InternalTranslationResult | null> {
    const timeout = this.config.get<number>('sdcv.timeoutMs') ?? 3000;
    const dataDir = resolve(config.path);

    let stdout: string;
    try {
      const result = await execFileAsync(
        'sdcv',
        [
          '--non-interactive',
          '--json-output',
          '--utf8-output',
          '--data-dir',
          dataDir,
          '-u',
          config.dictName,
          text,
        ],
        { timeout, maxBuffer: 16 * 1024 * 1024 },
      );
      stdout = result.stdout;
    } catch (err) {
      // sdcv exits non-zero (e.g. code 2) for "nothing found" while still
      // printing valid JSON (`[]`) to stdout — that's a not-found, not a crash.
      // A timeout (killed) or a genuinely broken invocation is the real error.
      const e = err as { killed?: boolean; signal?: string; stdout?: string };
      if (e.killed || e.signal) {
        throw new BadGatewayException(`sdcv timed out after ${timeout}ms`);
      }
      stdout = e.stdout ?? '';
      if (!stdout.trim()) {
        throw new BadGatewayException(
          `sdcv lookup failed: ${(err as Error).message}`,
        );
      }
    }

    let entries: SdcvEntry[];
    try {
      entries = JSON.parse(stdout || '[]') as SdcvEntry[];
    } catch (err) {
      throw new BadGatewayException(
        `sdcv produced malformed JSON: ${(err as Error).message}`,
      );
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return null; // not found — caller may fall through to Azure
    }

    // A single dict may return multiple entries (homographs, e.g. fly as
    // adjective/noun/verb). Concatenate their senses in order, then dedupe.
    const senses = dedupeAlternatives(
      entries.flatMap((e) =>
        parseDefinition(e.definition ?? '', config.format),
      ),
    );

    if (senses.length === 0) {
      return null; // definitions parsed to nothing → treat as not found
    }

    return {
      source: entries[0].word,
      senses,
      examples: [],
      provider: 'sdcv',
    };
  }
}
