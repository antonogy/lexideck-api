import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslationResultDto } from './dto/translation-result.dto';
import { validateLanguagePair } from './supported-languages';
import { TranslateService } from './translate.service';

@ApiTags('translate')
@ApiSecurity('apiKey')
@Controller('v1/translate')
export class TranslateController {
  constructor(private readonly service: TranslateService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Translate a word or idiom' })
  @ApiBody({ type: TranslateRequestDto })
  @ApiResponse({ status: 200, type: TranslationResultDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 502, description: 'Upstream error' })
  @ApiResponse({ status: 503, description: 'Unsupported language pair' })
  async translate(
    @Body() body: TranslateRequestDto,
  ): Promise<TranslationResultDto> {
    validateLanguagePair(body.from, body.to);
    return this.service.translate(body);
  }
}
