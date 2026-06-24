import { ApiProperty } from '@nestjs/swagger';

export type CanonicalPosTag = 'NOUN' | 'VERB' | 'ADJ' | 'ADV' | 'PREP';

export type Provider = 'sdcv' | 'azure';

// One parsed dictionary sense. Used internally as the element type for
// SdcvService/AzureDictionaryService/merge output (senses[], senses[0] = primary),
// and as the public shape for TranslationResultDto.alternatives (post-finalization,
// primary extracted). `canonicalPosTag` is internal-only and stripped before serialization.
export class TranslationAlternativeDto {
  @ApiProperty({ example: 'муха' })
  translation!: string;

  @ApiProperty({ example: 'муха' })
  normalizedTranslation!: string;

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
// senses[0] is primary; senses[1:] are secondary. Top-level translation fields are not set yet.
export interface InternalTranslationResult {
  source: string;
  senses: TranslationAlternativeDto[];
  examples: TranslationExampleDto[];
  provider: Provider;
}

// Public response shape produced by finalizeResult().
export class TranslationResultDto {
  @ApiProperty({ example: 'fly' })
  source!: string;

  @ApiProperty({ example: 'летать' })
  translation!: string;

  @ApiProperty({ example: 'летать' })
  normalizedTranslation!: string;

  @ApiProperty({ description: 'Localized POS abbreviation.', example: 'гл' })
  posTag!: string;

  @ApiProperty({
    type: [TranslationAlternativeDto],
    description: 'Other senses; excludes the primary translation.',
  })
  alternatives!: TranslationAlternativeDto[];

  @ApiProperty({ type: [TranslationExampleDto] })
  examples!: TranslationExampleDto[];

  @ApiProperty({ enum: ['sdcv', 'azure'], example: 'sdcv' })
  provider!: Provider;
}
