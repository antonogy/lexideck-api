import { Module } from '@nestjs/common';
import { DictionaryConfigService } from './dictionary-config.service';
import { SdcvService } from './sdcv.service';

@Module({
  providers: [SdcvService, DictionaryConfigService],
  exports: [SdcvService, DictionaryConfigService],
})
export class SdcvModule {}
