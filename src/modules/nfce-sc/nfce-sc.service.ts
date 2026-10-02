import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NfeAmbiente, NfeSyncStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeService } from '../nfe/nfe.service';
import { NFCE_SC_CLIENT, NfceScClient } from '../../integrations/nfce-sc/nfce-sc.types';
import { ConfigureNfceScSyncDto } from './dto/configure-nfce-sc-sync.dto';

@Injectable()
export class NfceScService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nfeService: NfeService,
    @Inject(NFCE_SC_CLIENT) private readonly client: NfceScClient
  ) {}

  async listControls(clienteId: string) {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    return this.prisma.nfceScSyncControle.findMany({
      where: { clienteId },
      include: {
        estabelecimento: { select: { id: true, cnpj: true, razaoSocial: true } },
        certificado: { select: { id: true, nome: true, cnpjTitular: true, validadeFim: true, ativo: true } }
      },
      orderBy: [{ estabelecimento: { razaoSocial: 'asc' } }, { ambiente: 'asc' }]
    });
  }

  async listDocuments(clienteId: string) {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    return this.prisma.nfeDocumento.findMany({
      where: { clienteId, modelo: '65', origem: 'sef_sc_nfce' },
      orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true, clienteId: true, estabelecimentoId: true, ambiente: true, nsu: true,
        chaveAcesso: true, numeroNfe: true, serie: true, modelo: true, dataEmissao: true,
        status: true, cnpjEmitente: true, razaoSocialEmitente: true, cnpjDestinatario: true,
        razaoSocialDestinatario: true, valorTotal: true, xmlCompletoDisponivel: true,
        xmlCompletoPath: true, origem: true, createdAt: true
      }
    });
  }

  async configure(dto: ConfigureNfceScSyncDto) {
    if (dto.ambiente !== NfeAmbiente.producao) {
      throw new BadRequestException('A especificacao atual da SEF/SC publica somente o ambiente de producao');
    }
    const [establishment, certificate] = await Promise.all([
      this.prisma.clienteEstabelecimento.findFirst({
        where: { id: dto.estabelecimentoId, clienteId: dto.clienteId, ativo: true }
      }),
      this.prisma.certificado.findFirst({
        where: {
          id: dto.certificadoId,
          ativo: true,
          OR: [{ clienteId: dto.clienteId }, { estabelecimentoId: dto.estabelecimentoId }, { clienteId: null }],
          AND: [{ OR: [{ estabelecimentoId: null }, { estabelecimentoId: dto.estabelecimentoId }] }]
        }
      })
    ]);
    if (!establishment) throw new NotFoundException('Estabelecimento ativo nao encontrado para o cliente');
    if (!certificate) throw new BadRequestException('Selecione um certificado ativo vinculado ao cliente ou estabelecimento');
    if (certificate.validadeFim && certificate.validadeFim < new Date()) {
      throw new BadRequestException('O certificado selecionado esta vencido');
    }
    return this.prisma.nfceScSyncControle.upsert({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: establishment.cnpj,
          ambiente: dto.ambiente
        }
      },
      create: {
        clienteId: dto.clienteId,
        estabelecimentoId: establishment.id,
        cnpjConsulta: establishment.cnpj,
        certificadoId: certificate.id,
        ambiente: dto.ambiente,
        indAtor: dto.indAtor,
        status: NfeSyncStatus.ativo
      },
      update: {
        estabelecimentoId: establishment.id,
        certificadoId: certificate.id,
        indAtor: dto.indAtor,
        status: NfeSyncStatus.ativo,
        proximaExecucao: null,
        ultimaMensagem: 'Configuracao atualizada; cursor NSU preservado.'
      },
      include: { estabelecimento: true, certificado: { select: { id: true, nome: true, cnpjTitular: true } } }
    });
  }

  async pause(clienteId: string, id: string) {
    const result = await this.prisma.nfceScSyncControle.updateMany({
      where: { id, clienteId },
      data: { status: NfeSyncStatus.pausado, ultimaMensagem: 'Controle pausado manualmente' }
    });
    if (!result.count) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    return { paused: true };
  }

  async run(clienteId: string, id: string) {
    const control = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
    if (!control) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    if (control.status !== NfeSyncStatus.ativo) throw new BadRequestException('O controle NFC-e SC esta pausado');
    if (control.proximaExecucao && control.proximaExecucao > new Date()) {
      throw new BadRequestException(`Proxima consulta permitida em ${control.proximaExecucao.toISOString()}`);
    }

    let result;
    try {
      result = await this.client.download({
        clienteId,
        cnpjConsulta: control.cnpjConsulta,
        certificadoId: control.certificadoId || '',
        ambiente: control.ambiente,
        ultimoNsu: control.ultimoNsuConsultado,
        indAtor: control.indAtor
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const certificateError = /certificado|pfx|tls|handshake/i.test(message);
      await this.prisma.nfceScSyncControle.update({
        where: { id: control.id },
        data: {
          status: certificateError ? NfeSyncStatus.erro_certificado : NfeSyncStatus.erro_api,
          ultimaExecucao: new Date(),
          proximaExecucao: new Date(Date.now() + 60 * 60 * 1000),
          ultimaMensagem: message
        }
      });
      throw new BadRequestException(message);
    }
    const now = new Date();
    const retryOneHour = result.cStat !== '117' && result.cStat !== '118';
    const complete = result.cStat === '117' || (result.cStat === '118' && result.documentos.length < 50);
    const authFailure = result.cStat === '8002' || result.cStat === '8004';
    const certificateFailure = ['280', '281', '282', '283', '284', '285', '286'].includes(result.cStat);
    let saved = 0;
    let cursor = control.ultimoNsuConsultado;
    for (const document of result.documentos) {
      await this.nfeService.persistNfceScDocument({
        clienteId,
        estabelecimentoId: control.estabelecimentoId,
        ambiente: control.ambiente,
        cnpjConsulta: control.cnpjConsulta,
        xml: document.xml
      });
      saved += 1;
      if (document.nsu > cursor) cursor = document.nsu;
    }
    const delayMs = retryOneHour ? 60 * 60 * 1000 : complete ? 12 * 60 * 60 * 1000 : 0;
    const next = delayMs ? new Date(now.getTime() + delayMs) : null;
    await this.prisma.nfceScSyncControle.update({
      where: { id: control.id },
      data: {
        status: authFailure ? NfeSyncStatus.erro_autorizacao : certificateFailure ? NfeSyncStatus.erro_certificado : NfeSyncStatus.ativo,
        ultimoNsuConsultado: cursor,
        ultimaExecucao: now,
        proximaExecucao: next,
        totalDocumentosBaixados: { increment: saved },
        ultimaMensagem: `SEF/SC ${result.cStat}: ${result.xMotivo}. ${saved} documento(s) armazenado(s).`
      }
    });
    return { cStat: result.cStat, xMotivo: result.xMotivo, documentosRecebidos: result.documentos.length, documentosArmazenados: saved, ultimoNsu: cursor.toString(), proximaExecucao: next };
  }
}
