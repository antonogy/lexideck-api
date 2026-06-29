import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureDictionaryService } from '../azure/azure-dictionary.service';
import { isAzureEnabled } from '../config/configuration';
import { DictionaryConfigService } from '../sdcv/dictionary-config.service';
import { mergeSdcvResults } from '../sdcv/merge';
import { SdcvService } from '../sdcv/sdcv.service';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslationResultDto } from './dto/translation-result.dto';
import { finalizeResult } from './pos-tag';

@Injectable()
export class TranslateService {
  constructor(
    private readonly dictConfig: DictionaryConfigService,
    private readonly sdcv: SdcvService,
    private readonly azure: AzureDictionaryService,
    private readonly config: ConfigService,
  ) {}

  private get azureEnabled(): boolean {
    return isAzureEnabled(this.config);
  }

  async translate(req: TranslateRequestDto): Promise<TranslationResultDto> {
    const config = this.dictConfig.getConfig(req.from, req.to);

    if (config) {
      const queries =
        req.normalized && req.normalized !== req.text
          ? [req.normalized, req.text]
          : [req.text];

      // Any sdcv error/crash/timeout on ANY query → 502, no Azure fallback.
      const results = await Promise.all(
        queries.map((q) => this.sdcv.lookup(q, config)),
      );

      const merged = mergeSdcvResults(queries, results);
      if (merged) {
        const final = finalizeResult(merged, req.to);
        return this.maybeAttachExamples(final, req); // soft-fail for sdcv
      }
      // both null → fall through to Azure (or 404 if Azure disabled)
    }

    if (!this.azureEnabled) {
      throw new NotFoundException();
    }

    const azureResult = await this.azure.lookup(req.text, req.from, req.to);
    const final = finalizeResult(azureResult, req.to);
    return this.maybeAttachExamples(final, req); // hard-fail for azure
  }

  // Attaches Azure examples when withExamples is set. Error handling differs by
  // provider: sdcv → soft fail (examples stays []); azure → hard fail (→ 502).
  private async maybeAttachExamples(
    result: TranslationResultDto,
    req: TranslateRequestDto,
  ): Promise<TranslationResultDto> {
    if (!req.withExamples || !this.azureEnabled) {
      return result;
    }

    // sdcv already served the primary result, so an Examples hiccup is soft
    // (examples stays []); on the azure path it's hard (errors propagate → 502).
    const swallow = result.provider === 'sdcv';
    try {
      const examples = await this.azure.examples(
        req.text,
        result.senses[0]?.normalizedTranslation ?? req.text,
        req.from,
        req.to,
      );
      return { ...result, examples };
    } catch (err) {
      if (swallow) {
        return result;
      }
      throw err;
    }
  }
}
