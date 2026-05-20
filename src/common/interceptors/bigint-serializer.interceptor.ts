import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => this.serializeBigInt(data)));
  }

  private serializeBigInt(value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeBigInt(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if (value instanceof Date || Buffer.isBuffer(value)) {
      return value;
    }

    const serialized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      serialized[key] = this.serializeBigInt(nestedValue);
    }

    return serialized;
  }
}
