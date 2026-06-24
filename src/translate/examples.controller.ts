import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AzureDictionaryService } from '../azure/azure-dictionary.service';
import { ExamplesRequestDto } from './dto/examples-request.dto';
import { ExamplesResponseDto } from './dto/examples-response.dto';
import { validateLanguagePair } from './supported-languages';

@ApiTags('examples')
@ApiSecurity('apiKey')
@Controller('v1/examples')
export class ExamplesController {
  constructor(
    private readonly azure: AzureDictionaryService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Fetch usage examples for an alternative translation',
  })
  @ApiBody({ type: ExamplesRequestDto })
  @ApiResponse({ status: 200, type: ExamplesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 502, description: 'Upstream error' })
  @ApiResponse({ status: 503, description: 'Unsupported language pair' })
  async examples(
    @Body() body: ExamplesRequestDto,
  ): Promise<ExamplesResponseDto> {
    validateLanguagePair(body.from, body.to);

    const azureEnabled = this.config.get<boolean>('azure.enabled') ?? true;
    if (!azureEnabled) {
      return { examples: [] };
    }

    const examples = await this.azure.examples(
      body.text,
      body.translation,
      body.from,
      body.to,
    );
    return { examples };
  }
}
