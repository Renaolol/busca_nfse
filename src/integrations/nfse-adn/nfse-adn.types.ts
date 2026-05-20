import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';

export interface AdnDFeResult {
  nsu: bigint;
  hasDocument: boolean;
  xml?: string;
  chaveAcesso?: string;
  rawResponse: unknown;
  statusCode: number;
  message?: string;
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
  }): Promise<unknown>;
}

export const NFSE_ADN_CLIENT = Symbol('NFSE_ADN_CLIENT');
