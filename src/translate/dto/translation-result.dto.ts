import { ApiProperty } from '@nestjs/swagger';

export type CanonicalPosTag = 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP';

export type Provider = 'sdcv' | 'azure';

// One parsed dictionary sense. Used internally as the element type for
// SdcvService/AzureDictionaryService/merge output, and as the public shape for
// TranslationResultDto.senses (post-finalization). `canonicalPosTag` is internal-only
// and stripped before serialization.
export class TranslationSenseDto {
  @ApiProperty({ example: ['муха'], type: [String] })
  translation!: string[];

  @ApiProperty({
    example: ['(non-technical) any fly of family Muscidae'],
    type: [String],
  })
  description!: string[];

  @ApiProperty({ example: 'муха', required: false })
  normalizedTranslation?: string;

  @ApiProperty({
    description:
      'Localized, lowercase, punctuation-free POS abbreviation in the target language.',
    example: 'сущ',
  })
  posTag!: string;

  // Internal only — not part of the public contract; stripped by finalizeResult().
  canonicalPosTag?: CanonicalPosTag | null;
}

export class TranslationExampleDto {
  @ApiProperty({ example: 'На кухне летала ' })
  targetPrefix!: string;

  @ApiProperty({ example: 'муха' })
  targetTerm!: string;

  @ApiProperty({ example: '.' })
  targetSuffix!: string;
}

// Internal working shape produced by SdcvService / AzureDictionaryService / mergeSdcvResults.
export interface InternalTranslationResult {
  source: string;
  senses: TranslationSenseDto[];
  examples: TranslationExampleDto[];
  provider: Provider;
}

// Public response shape produced by finalizeResult().
export class TranslationResultDto {
  @ApiProperty({ example: 'fly' })
  source!: string;

  @ApiProperty({ type: [TranslationSenseDto] })
  senses!: TranslationSenseDto[];

  @ApiProperty({ type: [TranslationExampleDto] })
  examples!: TranslationExampleDto[];

  @ApiProperty({ enum: ['sdcv', 'azure'], example: 'sdcv' })
  provider!: Provider;
}
