import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';

export interface NfseEmissorPublicoNfseResult {
  statusCode: number;
  chaveAcesso: string;
  xml?: string;
  rawResponse: unknown;
  message?: string;
}

export interface NfseEmissorPublicoDpsResult {
  statusCode: number;
  dpsId: string;
  xml?: string;
  rawResponse: unknown;
  message?: string;
}

export interface NfseEmissorPublicoClient {
  getNfseByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoNfseResult>;

  getNfseByDpsId(params: {
    dpsId: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoDpsResult>;
}

export const NFSE_EMISSOR_PUBLICO_CLIENT = Symbol('NFSE_EMISSOR_PUBLICO_CLIENT');
