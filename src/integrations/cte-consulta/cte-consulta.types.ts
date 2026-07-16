import { NfeAmbiente } from '@prisma/client';

export interface CteConsultaDocument {
  schema: string;
  xml: string;
  chaveAcesso?: string;
}

export interface CteConsultaResult {
  statusCode: number;
  cStat?: string;
  xMotivo?: string;
  documents: CteConsultaDocument[];
  rawResponse: unknown;
}

export interface CteConsultaClient {
  consultarPorChave(params: {
    chaveAcesso: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<CteConsultaResult>;
}

export const CTE_CONSULTA_CLIENT = Symbol('CTE_CONSULTA_CLIENT');
