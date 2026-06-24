import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';

// Maps NestJS exceptions to the spec's `{ "error": "...", "message"? }` shapes.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof UnauthorizedException) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (exception instanceof BadRequestException) {
      res
        .status(400)
        .json({ error: 'invalid_request', message: this.message(exception) });
      return;
    }
    if (exception instanceof NotFoundException) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (exception instanceof ServiceUnavailableException) {
      res.status(503).json({ error: 'unsupported_language_pair' });
      return;
    }
    if (exception instanceof BadGatewayException) {
      res
        .status(502)
        .json({ error: 'upstream_error', message: this.message(exception) });
      return;
    }

    // Unhandled — log and return a generic 500.
    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    res.status(status).json({ error: 'internal_error' });
  }

  private message(exception: HttpException): string {
    const resBody = exception.getResponse();
    if (typeof resBody === 'string') {
      return resBody;
    }
    const msg = (resBody as { message?: string | string[] }).message;
    if (Array.isArray(msg)) {
      return msg.join('; ');
    }
    return msg ?? exception.message;
  }
}
