import { Injectable } from '@nestjs/common';
import { NfeAmbiente } from '@prisma/client';
import { NfeDistribuicaoClient, NfeDistribuicaoResult } from './nfe-distribuicao.types';

@Injectable()
export class RealNfeDistribuicaoClient implements NfeDistribuicaoClient {
  async distribuirPorNsu(params: {
    cnpjConsulta: string;
    ultNsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    return {
      statusCode: 501,
      cStat: '500',
      xMotivo: `Integracao real de NF-e ainda nao configurada para ${params.cnpjConsulta} em ${params.ambiente}`,
      ultNsu: params.ultNsu,
      maxNsu: params.ultNsu,
      documents: [],
      rawResponse: {
        certificateId: params.certificateId
      }
    };
  }
}
