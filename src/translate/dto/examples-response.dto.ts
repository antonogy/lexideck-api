import { ApiProperty } from '@nestjs/swagger';
import { TranslationExampleDto } from './translation-result.dto';

export class ExamplesResponseDto {
  @ApiProperty({
    type: [TranslationExampleDto],
    description: 'May be empty; not an error.',
  })
  examples!: TranslationExampleDto[];
}
