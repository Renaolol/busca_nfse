import { Injectable } from '@nestjs/common';
import { NfeScClient, NfeScDownloadResult } from './nfe-sc.types';

@Injectable()
export class FakeNfeScClient implements NfeScClient {
  async download(params: { ultimoNsu: bigint }): Promise<NfeScDownloadResult> {
    return {
      cStat: '117',
      xMotivo: 'Nenhum DF-e localizado (resposta simulada)',
      ultimoNsu: params.ultimoNsu,
      documentos: [],
      httpStatus: 200
    };
  }
}
