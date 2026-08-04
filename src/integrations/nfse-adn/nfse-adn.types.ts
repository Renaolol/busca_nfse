import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';

export interface AdnDFeDocument {
  nsu?: bigint;
  xml: string;
  chaveAcesso?: string;
  message?: string;
}

export interface AdnDFeResult {
  nsu: bigint;
  hasDocument: boolean;
  xml?: string;
  chaveAcesso?: string;
  documents?: AdnDFeDocument[];
  rawResponse: unknown;
  statusCode: number;
  message?: string;
}

export interface AdnEventosResult {
  statusCode: number;
  data?: unknown;
  rawBody?: string;
  headers?: Record<string, string | string[] | undefined>;
  error?: string;
}

export interface NfseAdnClient {
  getDFeByNsu(params: {
    cnpjConsulta: string;
    nsu: bigint;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<AdnDFeResult>;

  getEventosByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<AdnEventosResult>;
}

export const NFSE_ADN_CLIENT = Symbol('NFSE_ADN_CLIENT');
