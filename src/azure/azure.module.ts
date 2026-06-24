import { Module } from '@nestjs/common';
import { AzureDictionaryService } from './azure-dictionary.service';

@Module({
  providers: [AzureDictionaryService],
  exports: [AzureDictionaryService],
})
export class AzureModule {}
