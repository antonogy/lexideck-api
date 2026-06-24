import { BadRequestException } from '@nestjs/common';

// MVP universe of requestable language codes (spec "Supported Languages").
export const SUPPORTED_LANGUAGES = new Set<string>([
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'ru',
  'nl',
  'pl',
  'uk',
]);

// Throws BadRequestException (→ 400 invalid_request) when either code is outside
// the supported set or when from === to.
export function validateLanguagePair(from: string, to: string): void {
  if (!SUPPORTED_LANGUAGES.has(from)) {
    throw new BadRequestException(`unsupported source language: ${from}`);
  }
  if (!SUPPORTED_LANGUAGES.has(to)) {
    throw new BadRequestException(`unsupported target language: ${to}`);
  }
  if (from === to) {
    throw new BadRequestException('from and to must differ');
  }
}
