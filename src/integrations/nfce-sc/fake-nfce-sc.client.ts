import { Injectable } from '@nestjs/common';
import { NfceScClient, NfceScDownloadResult } from './nfce-sc.types';

@Injectable()
export class FakeNfceScClient implements NfceScClient {
  async download(params: { ultimoNsu: bigint }): Promise<NfceScDownloadResult> {
    return { cStat: '117', xMotivo: 'Nenhum DF-e localizado (resposta simulada)', ultimoNsu: params.ultimoNsu, documentos: [], httpStatus: 200 };
  }
}
