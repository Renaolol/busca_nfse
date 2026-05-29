import { Injectable } from '@nestjs/common';
import { NfseService } from '../modules/nfse/nfse.service';

@Injectable()
export class GerarDanfsePendenteJob {
  static readonly jobName = 'gerar_danfse_pendente';

  constructor(private readonly nfseService: NfseService) {}

  async run(params?: { clienteId?: string; limit?: number }): Promise<{
    filtros: {
      clienteId: string | null;
      estabelecimentoId: string | null;
      ambiente: 'producao' | 'producao_restrita' | null;
      somenteIncompletos: boolean;
      regenerarDanfse: boolean;
      limit: number;
    };
    totalSelecionados: number;
    processados: number;
    atualizados: number;
    falhas: number;
    erros: Array<{ id: string; chaveAcesso: string; erro: string }>;
  }> {
    return this.nfseService.reprocessarXmls({
      clienteId: params?.clienteId,
      somenteIncompletos: true,
      regenerarDanfse: true,
      limit: params?.limit ?? 200
    });
  }
}
