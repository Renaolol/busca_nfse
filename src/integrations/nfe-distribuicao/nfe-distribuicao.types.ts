import { NfeAmbiente } from '@prisma/client';

export interface NfeDistribuicaoDocument {
  nsu?: bigint;
  schema: string;
  xml: string;
  chaveAcesso?: string;
}

export interface NfeDistribuicaoResult {
  statusCode: number;
  cStat?: string;
  xMotivo?: string;
  ultNsu: bigint;
  maxNsu: bigint;
  documents: NfeDistribuicaoDocument[];
  rawResponse: unknown;
}

export interface NfeDistribuicaoClient {
  distribuirPorNsu(params: {
    cnpjConsulta: string;
    ultNsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult>;
}

export const NFE_DISTRIBUICAO_CLIENT = Symbol('NFE_DISTRIBUICAO_CLIENT');
