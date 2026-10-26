import { NfeAmbiente } from '@prisma/client';

export type NfeManifestacaoTipo =
  | 'ciencia_operacao'
  | 'confirmacao_operacao'
  | 'desconhecimento_operacao'
  | 'operacao_nao_realizada';

export const NFE_MANIFESTACAO_EVENT_CODES: Record<NfeManifestacaoTipo, string> = {
  ciencia_operacao: '210210',
  confirmacao_operacao: '210200',
  desconhecimento_operacao: '210220',
  operacao_nao_realizada: '210240'
};

export interface NfeManifestacaoResult {
  statusCode: number;
  cStat: string | null;
  xMotivo: string | null;
  eventCStat: string | null;
  eventXMotivo: string | null;
  nProt: string | null;
  signedEventXml?: string;
  responseXml?: string;
}

export interface NfeManifestacaoClient {
  sendManifestacao(params: {
    cnpjConsulta: string;
    chaveAcesso: string;
    tipo: NfeManifestacaoTipo;
    sequencia: number;
    justificativa?: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeManifestacaoResult>;
}

export class NfeManifestacaoClientError extends Error {
  constructor(
    message: string,
    readonly requestMayHaveBeenSent: boolean,
    readonly failureStage?: 'certificate' | 'event_signing' | 'communication' | 'response',
    readonly signedEventXml?: string,
    readonly responseXml?: string
  ) {
    super(message);
    this.name = 'NfeManifestacaoClientError';
  }
}

export const NFE_MANIFESTACAO_CLIENT = Symbol('NFE_MANIFESTACAO_CLIENT');
