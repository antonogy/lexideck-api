import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ExamplesRequestDto {
  @ApiProperty({
    description:
      'Original source word/idiom (raw input, same as /v1/translate text).',
    example: 'flies',
  })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiProperty({
    description: "The tapped alternative's translation/normalizedTranslation.",
    example: 'муха',
  })
  @IsString()
  @IsNotEmpty()
  translation!: string;

  @ApiProperty({ example: 'en' })
  @IsString()
  @Length(2, 2)
  from!: string;

  @ApiProperty({ example: 'ru' })
  @IsString()
  @Length(2, 2)
  to!: string;
}
