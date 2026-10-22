import { NfeAmbiente } from '@prisma/client';

export type NfeScDfe = {
  nsu: bigint;
  chaveAcesso: string | null;
  schema: string;
  xml: string;
};

export type NfeScDownloadResult = {
  cStat: string;
  xMotivo: string;
  ultimoNsu: bigint;
  documentos: NfeScDfe[];
  httpStatus: number;
};

export interface NfeScClient {
  download(params: {
    clienteId: string;
    estabelecimentoId: string;
    cpfConsulta: string;
    certificadoId: string;
    ambiente: NfeAmbiente;
    ultimoNsu: bigint;
    indAtor: number;
  }): Promise<NfeScDownloadResult>;
}

export const NFE_SC_CLIENT = Symbol('NFE_SC_CLIENT');
