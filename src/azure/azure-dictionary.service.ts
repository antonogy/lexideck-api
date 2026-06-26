import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAzureEnabled } from '../config/configuration';
import {
  CanonicalPosTag,
  InternalTranslationResult,
  TranslationAlternativeDto,
  TranslationExampleDto,
} from '../translate/dto/translation-result.dto';

const AZURE_BASE = 'https://api.cognitive.microsofttranslator.com';

// Azure's POS tagset already matches the canonical tags 1:1.
const AZURE_TO_CANONICAL: Record<string, CanonicalPosTag> = {
  NOUN: 'NOUN',
  VERB: 'VERB',
  ADJ: 'ADJ',
  ADV: 'ADV',
  PREP: 'PREP',
};

interface AzureLookupTranslation {
  displayTarget: string;
  normalizedTarget: string;
  posTag: string;
  confidence: number;
}

interface AzureLookupEntry {
  normalizedSource: string;
  displaySource: string;
  translations: AzureLookupTranslation[];
}

interface AzureExampleEntry {
  examples: {
    targetPrefix: string;
    targetTerm: string;
    targetSuffix: string;
  }[];
}

@Injectable()
export class AzureDictionaryService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    // Fail fast if Azure is enabled but credentials are missing.
    if (this.enabled && (!this.key || !this.region)) {
      throw new Error(
        'AZURE_ENABLED=true but AZURE_TRANSLATOR_KEY/AZURE_TRANSLATOR_REGION are not set',
      );
    }
  }

  private get enabled(): boolean {
    return isAzureEnabled(this.config);
  }
  private get key(): string {
    return this.config.get<string>('azure.key') ?? '';
  }
  private get region(): string {
    return this.config.get<string>('azure.region') ?? '';
  }

  // Dictionary Lookup. Throws NotFoundException on empty translations[];
  // throws BadGateway/ServiceUnavailable on transport/auth/unsupported-pair errors.
  async lookup(
    queryTerm: string,
    from: string,
    to: string,
  ): Promise<InternalTranslationResult> {
    const url = `${AZURE_BASE}/dictionary/lookup?api-version=3.0&from=${from}&to=${to}`;
    const body = await this.post<AzureLookupEntry[]>(url, [
      { Text: queryTerm },
    ]);

    const entry = body[0];
    if (!entry || !entry.translations || entry.translations.length === 0) {
      throw new NotFoundException();
    }

    const senses: TranslationAlternativeDto[] = [...entry.translations]
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .map((t) => ({
        translation: t.displayTarget,
        normalizedTranslation: t.normalizedTarget,
        posTag: '',
        canonicalPosTag: AZURE_TO_CANONICAL[t.posTag?.toUpperCase()] ?? null,
      }));

    return {
      source: entry.normalizedSource || queryTerm,
      senses,
      examples: [],
      provider: 'azure',
    };
  }

  // Dictionary Examples. Returns [] when Azure has none (not an error).
  async examples(
    queryTerm: string,
    translation: string,
    from: string,
    to: string,
  ): Promise<TranslationExampleDto[]> {
    const url = `${AZURE_BASE}/dictionary/examples?api-version=3.0&from=${from}&to=${to}`;
    const body = await this.post<AzureExampleEntry[]>(url, [
      { Text: queryTerm, Translation: translation },
    ]);

    const entry = body[0];
    if (!entry || !entry.examples) {
      return [];
    }
    return entry.examples.map((e) => ({
      targetPrefix: e.targetPrefix,
      targetTerm: e.targetTerm,
      targetSuffix: e.targetSuffix,
    }));
  }

  private async post<T>(url: string, payload: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key,
          'Ocp-Apim-Subscription-Region': this.region,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Network/DNS/connection failure.
      throw new BadGatewayException(
        `Azure request failed: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 400 = valid codes but dictionary-unsupported pair → 503; auth/other → 502.
      if (res.status === 400) {
        throw new ServiceUnavailableException(
          `Azure does not support this language pair: ${text}`,
        );
      }
      throw new BadGatewayException(`Azure error (${res.status}): ${text}`);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new BadGatewayException(
        `Azure returned malformed JSON: ${(err as Error).message}`,
      );
    }
  }
}
