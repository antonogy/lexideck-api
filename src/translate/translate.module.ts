import { Module } from '@nestjs/common';
import { AzureModule } from '../azure/azure.module';
import { SdcvModule } from '../sdcv/sdcv.module';
import { ExamplesController } from './examples.controller';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';

@Module({
  imports: [SdcvModule, AzureModule],
  controllers: [TranslateController, ExamplesController],
  providers: [TranslateService],
})
export class TranslateModule {}
