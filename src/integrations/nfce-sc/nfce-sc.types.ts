import { NfeAmbiente } from '@prisma/client';

export type NfceScDfe = { nsu: bigint; chaveAcesso: string | null; xml: string };
export type NfceScDownloadResult = {
  cStat: string;
  xMotivo: string;
  ultimoNsu: bigint;
  documentos: NfceScDfe[];
  httpStatus: number;
};

export interface NfceScClient {
  download(params: {
    clienteId: string;
    cnpjConsulta: string;
    certificadoId: string;
    ambiente: NfeAmbiente;
    ultimoNsu: bigint;
    indAtor: number;
  }): Promise<NfceScDownloadResult>;
}

export const NFCE_SC_CLIENT = Symbol('NFCE_SC_CLIENT');
