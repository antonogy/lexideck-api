import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class TranslateRequestDto {
  @ApiProperty({
    description: 'A single word or idiom as typed/spoken (not a sentence).',
    example: 'flies',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional({
    description:
      'Client-supplied lemma/normalized form of `text` (e.g. NLTagger).',
    example: 'fly',
  })
  @IsString()
  @IsOptional()
  normalized?: string;

  @ApiProperty({ description: 'BCP 47 source language code.', example: 'en' })
  @IsString()
  @Length(2, 2)
  from!: string;

  @ApiProperty({ description: 'BCP 47 target language code.', example: 'ru' })
  @IsString()
  @Length(2, 2)
  to!: string;

  @ApiPropertyOptional({
    description:
      'If true, an Azure Dictionary Examples call is made for the primary translation. Default false.',
    example: true,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  withExamples?: boolean;
}
