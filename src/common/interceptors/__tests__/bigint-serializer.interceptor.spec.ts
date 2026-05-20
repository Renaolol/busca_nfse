import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { BigIntSerializerInterceptor } from '../bigint-serializer.interceptor';

describe('BigIntSerializerInterceptor', () => {
  it('converte bigint para string em estruturas aninhadas', async () => {
    const interceptor = new BigIntSerializerInterceptor();
    const now = new Date('2026-01-01T10:00:00.000Z');

    const payload = {
      nsu: 123n,
      nested: {
        value: 456n
      },
      list: [1n, { inside: 2n }],
      date: now
    };

    const callHandler: CallHandler = {
      handle: () => of(payload)
    };

    const result = await firstValueFrom(
      interceptor.intercept({} as ExecutionContext, callHandler)
    );

    expect(result).toEqual({
      nsu: '123',
      nested: {
        value: '456'
      },
      list: ['1', { inside: '2' }],
      date: now
    });
  });
});
