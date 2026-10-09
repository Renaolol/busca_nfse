import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common';
import { NfeAmbiente, NfeSyncStatus, NfceScRecoveryStatus, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { MAX_UNPAGINATED_RESULTS } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeService } from '../nfe/nfe.service';
import { NFCE_SC_CLIENT, NfceScClient } from '../../integrations/nfce-sc/nfce-sc.types';
import { ConfigureNfceScSyncDto } from './dto/configure-nfce-sc-sync.dto';
import { QueryNfceScStoredDocumentsDto } from './dto/query-nfce-sc-stored-documents.dto';
import { ReprocessNfceScNsusDto } from './dto/reprocess-nfce-sc-nsus.dto';

@Injectable()
export class NfceScService implements OnModuleInit, OnModuleDestroy {
  private static readonly BATCH_SIZE = 50;
  private static readonly EXECUTION_LEASE_MS = 5 * 60 * 1000;
  private static readonly RECOVERY_INTERVAL_MS = 30 * 1000;
  private readonly logger = new Logger(NfceScService.name);
  private readonly runningControls = new Set<string>();
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nfeService: NfeService,
    @Inject(NFCE_SC_CLIENT) private readonly client: NfceScClient
  ) {}

  onModuleInit(): void {
    this.recoveryTimer = setInterval(() => {
      void this.resumeExpiredExecutions();
    }, NfceScService.RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  async listControls(clienteId: string) {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    return this.prisma.nfceScSyncControle.findMany({
      where: { clienteId },
      select: {
        id: true,
        clienteId: true,
        estabelecimentoId: true,
        cnpjConsulta: true,
        certificadoId: true,
        ambiente: true,
        indAtor: true,
        ultimoNsuConsultado: true,
        status: true,
        ultimaExecucao: true,
        proximaExecucao: true,
        ultimaMensagem: true,
        totalDocumentosBaixados: true,
        diagnosticoXmlCriadoEm: true,
        reprocessamentoNsuInicial: true,
        reprocessamentoNsuFinal: true,
        reprocessamentoNsuAtual: true,
        reprocessamentoStatus: true,
        reprocessamentoTotalDocumentos: true,
        reprocessamentoMensagem: true,
        reprocessamentoLease: true,
        createdAt: true,
        updatedAt: true,
        estabelecimento: { select: { id: true, cnpj: true, razaoSocial: true } },
        certificado: { select: { id: true, nome: true, cnpjTitular: true, validadeFim: true, ativo: true } }
      },
      orderBy: [{ estabelecimento: { razaoSocial: 'asc' } }, { ambiente: 'asc' }]
    });
  }

  async downloadErrorDiagnostic(clienteId: string, id: string) {
    const control = await this.prisma.nfceScSyncControle.findFirst({
      where: { id, clienteId },
      select: {
        cnpjConsulta: true,
        diagnosticoXmlRequisicao: true,
        diagnosticoXmlResposta: true,
        diagnosticoXmlCriadoEm: true
      }
    });
    if (!control) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    if (!control.diagnosticoXmlRequisicao || !control.diagnosticoXmlResposta) {
      throw new BadRequestException('Nao ha XML de diagnostico de erro 9999 salvo para este controle');
    }

    const zip = new JSZip();
    zip.file('requisicao.xml', control.diagnosticoXmlRequisicao);
    zip.file('resposta.xml', control.diagnosticoXmlResposta);
    zip.file('capturado-em.txt', control.diagnosticoXmlCriadoEm?.toISOString() || 'Data de captura indisponivel');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const timestamp = (control.diagnosticoXmlCriadoEm || new Date()).toISOString().replace(/[:.]/g, '-');
    const safeCnpj = control.cnpjConsulta.replace(/[^a-zA-Z0-9]/g, '');

    return {
      fileName: `nfce-sc-diagnostico-${safeCnpj}-${timestamp}.zip`,
      contentType: 'application/zip',
      contentBase64: zipBuffer.toString('base64')
    };
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

  async listStoredDocuments(query: QueryNfceScStoredDocumentsDto) {
    const client = await this.prisma.cliente.findUnique({ where: { id: query.clienteId }, select: { id: true } });
    if (!client) throw new NotFoundException('Cliente nao encontrado');
    if (query.dataInicio && query.dataFim && Date.parse(query.dataInicio) > Date.parse(query.dataFim)) {
      throw new BadRequestException('A data inicial nao pode ser maior que a data final');
    }

    const conditions: Prisma.NfeDocumentoWhereInput[] = [];
    if (query.tipoRelacao === 'emitidas') conditions.push({ tipoRelacao: 'emitida' });
    if (query.tipoRelacao === 'recebidas') conditions.push({ tipoRelacao: 'recebida' });

    const cnpj = String(query.cnpj || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cnpj) {
      conditions.push({ OR: [{ cnpjEmitente: { contains: cnpj } }, { cnpjDestinatario: { contains: cnpj } }] });
    }
    if (query.numeroNfce?.trim()) {
      conditions.push({ numeroNfe: { contains: query.numeroNfce.trim() } });
    }
    if (query.chaveAcesso?.trim()) {
      conditions.push({ chaveAcesso: { contains: query.chaveAcesso.trim() } });
    }
    if (query.dataInicio || query.dataFim) {
      conditions.push({
        dataEmissao: {
          gte: query.dataInicio ? new Date(`${query.dataInicio}T00:00:00.000-03:00`) : undefined,
          lte: query.dataFim ? new Date(`${query.dataFim}T23:59:59.999-03:00`) : undefined
        }
      });
    }

    const where: Prisma.NfeDocumentoWhereInput = {
      clienteId: query.clienteId,
      modelo: '65',
      origem: 'sef_sc_nfce',
      AND: conditions
    };
    const all = query.all === true;
    const page = all ? 1 : query.page ?? 1;
    const pageSize = all ? MAX_UNPAGINATED_RESULTS : query.pageSize ?? 100;
    const [total, items] = await Promise.all([
      this.prisma.nfeDocumento.count({ where }),
      this.prisma.nfeDocumento.findMany({
        where,
        orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
        skip: all ? 0 : (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          clienteId: true,
          estabelecimentoId: true,
          ambiente: true,
          chaveAcesso: true,
          numeroNfe: true,
          serie: true,
          modelo: true,
          dataEmissao: true,
          dataAutorizacao: true,
          status: true,
          tipoRelacao: true,
          schemaDoc: true,
          resumoDisponivel: true,
          xmlCompletoDisponivel: true,
          cnpjEmitente: true,
          razaoSocialEmitente: true,
          cnpjDestinatario: true,
          razaoSocialDestinatario: true,
          valorTotal: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ]);

    return {
      items,
      total,
      page,
      pageSize: all ? items.length : pageSize,
      totalPages: all ? Math.max(1, Math.ceil(total / MAX_UNPAGINATED_RESULTS)) : Math.max(1, Math.ceil(total / pageSize)),
      truncated: all && total > MAX_UNPAGINATED_RESULTS
    };
  }

  async downloadStoredDocumentsBatch(clienteId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const documents = await this.prisma.nfeDocumento.findMany({
      where: {
        id: { in: uniqueIds },
        clienteId,
        modelo: '65',
        origem: 'sef_sc_nfce'
      },
      select: { id: true }
    });
    if (!documents.length) throw new NotFoundException('Nenhuma NFC-e armazenada encontrada para os IDs informados');

    const payload = await this.nfeService.downloadLote({
      ids: documents.map(({ id }) => id),
      clienteId,
      tipoArquivo: 'xml'
    });
    return {
      ...payload,
      fileName: `nfce-sc-lote-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    };
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
    const currentControl = await this.prisma.nfceScSyncControle.findUnique({
      where: {
        clienteId_cnpjConsulta_ambiente: {
          clienteId: dto.clienteId,
          cnpjConsulta: establishment.cnpj,
          ambiente: dto.ambiente
        }
      },
      select: { status: true, reprocessamentoStatus: true }
    });
    if (currentControl?.status === NfeSyncStatus.processando) {
      throw new BadRequestException('Pause a consulta NFC-e SC antes de alterar a configuracao');
    }
    if (currentControl?.reprocessamentoStatus === NfceScRecoveryStatus.processando) {
      throw new BadRequestException('Pause o reprocessamento de NSUs antes de alterar a configuracao');
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
      data: {
        status: NfeSyncStatus.pausado,
        proximaExecucao: null,
        ultimaMensagem: 'Controle pausado manualmente. A consulta em andamento sera interrompida ao concluir o lote atual.'
      }
    });
    if (!result.count) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    await this.prisma.nfceScSyncControle.updateMany({
      where: { id, clienteId, reprocessamentoStatus: NfceScRecoveryStatus.processando },
      data: {
        reprocessamentoStatus: NfceScRecoveryStatus.pausado,
        reprocessamentoLease: null,
        reprocessamentoMensagem: 'Reprocessamento pausado manualmente; retome o mesmo intervalo para continuar.'
      }
    });
    return { paused: true };
  }

  async run(clienteId: string, id: string) {
    const control = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
    if (!control) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    if (control.reprocessamentoStatus === NfceScRecoveryStatus.processando) {
      throw new ConflictException('O reprocessamento de NSUs deste controle ainda esta em andamento');
    }
    if (control.status === NfeSyncStatus.processando) return this.toRunResponse(control, false);
    const retryingInternalServerError = /^SEF\/SC 9999:/i.test(control.ultimaMensagem || '');
    if (!retryingInternalServerError && control.proximaExecucao && control.proximaExecucao > new Date()) {
      throw new BadRequestException(`Proxima consulta permitida em ${control.proximaExecucao.toISOString()}`);
    }

    const now = new Date();
    const leaseUntil = this.newLease();
    const started = await this.prisma.nfceScSyncControle.updateMany({
      where: {
        id,
        clienteId,
        status: { notIn: [NfeSyncStatus.processando] },
        AND: [{
          OR: [
            { reprocessamentoStatus: null },
            { reprocessamentoStatus: { not: NfceScRecoveryStatus.processando } }
          ]
        }],
        ...(!retryingInternalServerError
          ? { OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }] }
          : {})
      },
      data: {
        status: NfeSyncStatus.processando,
        proximaExecucao: leaseUntil,
        ultimaExecucao: now,
        ultimaMensagem: 'Consulta SEF/SC iniciada. A continuacao dos lotes de ate 50 documentos e automatica.'
      }
    });

    if (!started.count) {
      const current = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
      if (current?.status === NfeSyncStatus.processando) return this.toRunResponse(current, false);
      if (current?.status === NfeSyncStatus.pausado) throw new BadRequestException('O controle NFC-e SC esta pausado');
      const currentHasInternalServerError = /^SEF\/SC 9999:/i.test(current?.ultimaMensagem || '');
      if (!currentHasInternalServerError && current?.proximaExecucao && current.proximaExecucao > new Date()) {
        throw new BadRequestException(`Proxima consulta permitida em ${current.proximaExecucao.toISOString()}`);
      }
      throw new BadRequestException('Nao foi possivel iniciar a consulta NFC-e SC; atualize o controle e tente novamente');
    }

    const startedControl = {
      ...control,
      status: NfeSyncStatus.processando,
      ultimaMensagem: 'Consulta SEF/SC iniciada. A continuacao dos lotes de ate 50 documentos e automatica.'
    };
    this.startBackgroundExecution(id, leaseUntil);
    return this.toRunResponse(startedControl, true);
  }

  async reprocessNsus(clienteId: string, id: string, dto: ReprocessNfceScNsusDto) {
    const control = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
    if (!control) throw new NotFoundException('Controle NFC-e SC nao encontrado');

    const nsuInicial = BigInt(dto.nsuInicial);
    const nsuFinal = BigInt(dto.nsuFinal);
    if (nsuInicial < 0n || nsuFinal < 1n || nsuFinal < nsuInicial) {
      throw new BadRequestException('Informe um intervalo de NSUs valido, com o NSU final igual ou maior que o inicial');
    }
    if (nsuFinal > control.ultimoNsuConsultado) {
      throw new BadRequestException(`O NSU final nao pode ultrapassar o ultimo NSU consultado (${control.ultimoNsuConsultado})`);
    }
    if (control.status === NfeSyncStatus.processando) {
      throw new ConflictException('Pause a consulta NFC-e SC antes de reprocessar NSUs');
    }
    if (control.reprocessamentoStatus === NfceScRecoveryStatus.processando) {
      if (control.reprocessamentoNsuInicial === nsuInicial && control.reprocessamentoNsuFinal === nsuFinal) {
        return this.toRecoveryResponse(control, false);
      }
      throw new ConflictException('Ja existe um reprocessamento de NSUs em andamento para este controle');
    }

    const now = new Date();
    if (control.proximaExecucao && control.proximaExecucao > now) {
      throw new BadRequestException(`Proxima consulta permitida em ${control.proximaExecucao.toISOString()}`);
    }

    const isResume =
      control.reprocessamentoNsuInicial === nsuInicial &&
      control.reprocessamentoNsuFinal === nsuFinal &&
      (control.reprocessamentoStatus === NfceScRecoveryStatus.pausado ||
        control.reprocessamentoStatus === NfceScRecoveryStatus.erro) &&
      control.reprocessamentoNsuAtual !== null;
    const initialCursor = nsuInicial > 0n ? nsuInicial - 1n : 0n;
    const currentCursor = isResume ? control.reprocessamentoNsuAtual! : initialCursor;
    const leaseUntil = this.newLease();
    const started = await this.prisma.nfceScSyncControle.updateMany({
      where: {
        id,
        clienteId,
        status: { not: NfeSyncStatus.processando },
        AND: [
          {
            OR: [
              { reprocessamentoStatus: null },
              { reprocessamentoStatus: { not: NfceScRecoveryStatus.processando } }
            ]
          },
          { OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }] }
        ]
      },
      data: {
        reprocessamentoNsuInicial: nsuInicial,
        reprocessamentoNsuFinal: nsuFinal,
        reprocessamentoNsuAtual: currentCursor,
        reprocessamentoStatus: NfceScRecoveryStatus.processando,
        reprocessamentoTotalDocumentos: isResume ? control.reprocessamentoTotalDocumentos : 0,
        reprocessamentoMensagem: isResume
          ? `Reprocessamento retomado a partir do NSU ${currentCursor}.`
          : `Reprocessamento do intervalo NSU ${nsuInicial}-${nsuFinal} iniciado.`,
        reprocessamentoLease: leaseUntil,
        proximaExecucao: leaseUntil
      }
    });

    if (!started.count) {
      const current = await this.prisma.nfceScSyncControle.findFirst({ where: { id, clienteId } });
      if (current?.reprocessamentoStatus === NfceScRecoveryStatus.processando) {
        return this.toRecoveryResponse(current, false);
      }
      if (current?.status === NfeSyncStatus.processando) {
        throw new ConflictException('Pause a consulta NFC-e SC antes de reprocessar NSUs');
      }
      throw new ConflictException('Nao foi possivel iniciar o reprocessamento; atualize o controle e tente novamente');
    }

    this.startBackgroundRecovery(id, leaseUntil);
    const startedControl = await this.prisma.nfceScSyncControle.findUnique({ where: { id } });
    if (!startedControl) throw new NotFoundException('Controle NFC-e SC nao encontrado');
    return this.toRecoveryResponse(startedControl, true);
  }

  private toRecoveryResponse(control: {
    reprocessamentoNsuInicial: bigint | null;
    reprocessamentoNsuFinal: bigint | null;
    reprocessamentoNsuAtual: bigint | null;
    reprocessamentoTotalDocumentos: number;
    reprocessamentoMensagem: string | null;
  }, started: boolean) {
    return {
      accepted: true,
      started,
      status: NfceScRecoveryStatus.processando,
      nsuInicial: String(control.reprocessamentoNsuInicial ?? 0n),
      nsuFinal: String(control.reprocessamentoNsuFinal ?? 0n),
      nsuAtual: String(control.reprocessamentoNsuAtual ?? 0n),
      totalDocumentos: control.reprocessamentoTotalDocumentos,
      mensagem: control.reprocessamentoMensagem || 'Reprocessamento NFC-e SC em andamento.'
    };
  }

  private startBackgroundRecovery(id: string, leaseUntil: Date): void {
    if (this.runningControls.has(id)) return;
    this.runningControls.add(id);
    void this.processNsuRecovery(id, leaseUntil)
      .catch(async (error: unknown) => {
        try {
          const current = await this.prisma.nfceScSyncControle.findUnique({ where: { id } });
          if (current?.reprocessamentoStatus === NfceScRecoveryStatus.processando && current.reprocessamentoLease) {
            await this.stopNsuRecoveryAfterError(id, current.reprocessamentoLease, error);
          }
        } catch (recoveryError) {
          this.logger.error(`Falha inesperada no reprocessamento NFC-e SC ${id}: ${this.toErrorMessage(recoveryError)}`);
        }
      })
      .finally(() => this.runningControls.delete(id));
  }

  private async processNsuRecovery(id: string, initialLease: Date): Promise<void> {
    let leaseUntil = initialLease;
    while (true) {
      const control = await this.prisma.nfceScSyncControle.findUnique({ where: { id } });
      if (
        !control ||
        control.reprocessamentoStatus !== NfceScRecoveryStatus.processando ||
        !this.sameDate(control.reprocessamentoLease, leaseUntil)
      ) {
        return;
      }

      const nsuFinal = control.reprocessamentoNsuFinal;
      const requestCursor = control.reprocessamentoNsuAtual;
      if (nsuFinal === null || requestCursor === null) {
        await this.stopNsuRecoveryAfterError(id, leaseUntil, new Error('Intervalo de NSUs ausente no reprocessamento.'));
        return;
      }
      if (requestCursor >= nsuFinal) {
        await this.finishNsuRecovery({
          id,
          leaseUntil,
          cursor: nsuFinal,
          totalDocuments: 0,
          message: `Reprocessamento concluido no intervalo NSU ${control.reprocessamentoNsuInicial}-${nsuFinal}. O cursor principal permaneceu em ${control.ultimoNsuConsultado}.`
        });
        return;
      }

      const renewedLease = this.newLease();
      const renewed = await this.prisma.nfceScSyncControle.updateMany({
        where: {
          id,
          status: { not: NfeSyncStatus.processando },
          reprocessamentoStatus: NfceScRecoveryStatus.processando,
          reprocessamentoLease: leaseUntil
        },
        data: { reprocessamentoLease: renewedLease, proximaExecucao: renewedLease }
      });
      if (!renewed.count) return;
      leaseUntil = renewedLease;

      let result;
      try {
        result = await this.client.download({
          clienteId: control.clienteId,
          cnpjConsulta: control.cnpjConsulta,
          certificadoId: control.certificadoId || '',
          ambiente: control.ambiente,
          ultimoNsu: requestCursor,
          indAtor: control.indAtor
        });
      } catch (error) {
        await this.stopNsuRecoveryAfterError(id, leaseUntil, error);
        return;
      }

      if (result.cStat === '117') {
        await this.finishNsuRecovery({
          id,
          leaseUntil,
          cursor: requestCursor,
          totalDocuments: 0,
          message: `Reprocessamento concluido. A SEF/SC nao retornou documentos no intervalo NSU ${control.reprocessamentoNsuInicial}-${nsuFinal}.`
        });
        return;
      }
      if (result.cStat !== '118') {
        await this.stopNsuRecoveryAfterError(id, leaseUntil, new Error(`SEF/SC ${result.cStat}: ${result.xMotivo}`));
        return;
      }

      const documents = result.documentos
        .filter((document) => document.nsu > requestCursor)
        .sort((left, right) => left.nsu < right.nsu ? -1 : left.nsu > right.nsu ? 1 : 0);
      if (!documents.length || documents[0].nsu > nsuFinal) {
        await this.finishNsuRecovery({
          id,
          leaseUntil,
          cursor: requestCursor,
          totalDocuments: 0,
          message: `Reprocessamento concluido sem documentos no intervalo NSU ${control.reprocessamentoNsuInicial}-${nsuFinal}. A SEF/SC disponibiliza somente os tres meses de referencia mais recentes.`
        });
        return;
      }

      let cursor = requestCursor;
      let totalDocuments = 0;
      for (const document of documents) {
        if (document.nsu > nsuFinal) break;
        await this.nfeService.persistNfceScDocument({
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          cnpjConsulta: control.cnpjConsulta,
          xml: document.xml
        });
        if (document.nsu > cursor) cursor = document.nsu;
        totalDocuments += 1;
      }

      if (documents.length === NfceScService.BATCH_SIZE && cursor <= requestCursor) {
        await this.stopNsuRecoveryAfterError(
          id,
          leaseUntil,
          new Error('A SEF/SC retornou um lote completo sem avancar o NSU; reprocessamento interrompido para evitar repeticao.')
        );
        return;
      }

      const outOfRange = documents.some((document) => document.nsu > nsuFinal);
      const completed = outOfRange || cursor >= nsuFinal || documents.length < NfceScService.BATCH_SIZE;
      const nextLease = completed ? null : this.newLease();
      const now = new Date();
      const message = completed
        ? `Reprocessamento concluido no intervalo NSU ${control.reprocessamentoNsuInicial}-${nsuFinal}. ${control.reprocessamentoTotalDocumentos + totalDocuments} documento(s) revisado(s); o cursor principal permaneceu em ${control.ultimoNsuConsultado}.`
        : `Reprocessamento em andamento: ${control.reprocessamentoTotalDocumentos + totalDocuments} documento(s) revisado(s), cursor do intervalo ${cursor} de ${nsuFinal}.`;
      const updated = await this.prisma.nfceScSyncControle.updateMany({
        where: {
          id,
          status: { not: NfeSyncStatus.processando },
          reprocessamentoStatus: NfceScRecoveryStatus.processando,
          reprocessamentoLease: leaseUntil
        },
        data: {
          reprocessamentoNsuAtual: outOfRange ? nsuFinal : cursor,
          reprocessamentoTotalDocumentos: { increment: totalDocuments },
          reprocessamentoStatus: completed ? NfceScRecoveryStatus.concluido : NfceScRecoveryStatus.processando,
          reprocessamentoMensagem: message,
          reprocessamentoLease: nextLease,
          proximaExecucao: completed ? new Date(now.getTime() + 12 * 60 * 60 * 1000) : nextLease
        }
      });
      if (!updated.count || completed) return;
      leaseUntil = nextLease!;
    }
  }

  private async finishNsuRecovery(params: {
    id: string;
    leaseUntil: Date;
    cursor: bigint;
    totalDocuments: number;
    message: string;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.nfceScSyncControle.updateMany({
      where: {
        id: params.id,
        status: { not: NfeSyncStatus.processando },
        reprocessamentoStatus: NfceScRecoveryStatus.processando,
        reprocessamentoLease: params.leaseUntil
      },
      data: {
        reprocessamentoNsuAtual: params.cursor,
        reprocessamentoTotalDocumentos: { increment: params.totalDocuments },
        reprocessamentoStatus: NfceScRecoveryStatus.concluido,
        reprocessamentoMensagem: params.message,
        reprocessamentoLease: null,
        proximaExecucao: new Date(now.getTime() + 12 * 60 * 60 * 1000)
      }
    });
  }

  private async stopNsuRecoveryAfterError(id: string, leaseUntil: Date, error: unknown): Promise<void> {
    const message = this.toErrorMessage(error);
    const next = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.nfceScSyncControle.updateMany({
      where: {
        id,
        status: { not: NfeSyncStatus.processando },
        reprocessamentoStatus: NfceScRecoveryStatus.processando,
        reprocessamentoLease: leaseUntil
      },
      data: {
        reprocessamentoStatus: NfceScRecoveryStatus.erro,
        reprocessamentoMensagem: `Falha no reprocessamento de NSUs: ${message}`,
        reprocessamentoLease: null,
        proximaExecucao: next
      }
    });
    this.logger.warn(`Reprocessamento NFC-e SC ${id} interrompido: ${message}`);
  }

  private toRunResponse(control: {
    ultimoNsuConsultado: bigint;
    totalDocumentosBaixados: number;
    ultimaMensagem: string | null;
  }, started: boolean) {
    return {
      accepted: true,
      started,
      status: NfeSyncStatus.processando,
      ultimoNsu: control.ultimoNsuConsultado.toString(),
      totalDocumentosBaixados: control.totalDocumentosBaixados,
      mensagem: control.ultimaMensagem || 'Consulta SEF/SC em andamento.'
    };
  }

  private startBackgroundExecution(id: string, leaseUntil: Date): void {
    if (this.runningControls.has(id)) return;
    this.runningControls.add(id);
    void this.processAllAvailableBatches(id, leaseUntil)
      .catch((error: unknown) => {
        this.logger.error(`Falha inesperada no sincronismo NFC-e SC ${id}: ${this.toErrorMessage(error)}`);
      })
      .finally(() => this.runningControls.delete(id));
  }

  private async processAllAvailableBatches(id: string, initialLease: Date): Promise<void> {
    let leaseUntil = initialLease;
    let savedInExecution = 0;

    while (true) {
      const control = await this.prisma.nfceScSyncControle.findUnique({ where: { id } });
      if (!control || control.status !== NfeSyncStatus.processando || !this.sameDate(control.proximaExecucao, leaseUntil)) return;

      const renewedLease = this.newLease();
      const renewed = await this.prisma.nfceScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: { proximaExecucao: renewedLease }
      });
      if (!renewed.count) return;
      leaseUntil = renewedLease;

      let result;
      try {
        result = await this.client.download({
          clienteId: control.clienteId,
          cnpjConsulta: control.cnpjConsulta,
          certificadoId: control.certificadoId || '',
          ambiente: control.ambiente,
          ultimoNsu: control.ultimoNsuConsultado,
          indAtor: control.indAtor
        });
      } catch (error) {
        await this.stopAfterError(id, leaseUntil, error);
        return;
      }

      let cursor = control.ultimoNsuConsultado;
      try {
        for (const document of result.documentos) {
          await this.nfeService.persistNfceScDocument({
            clienteId: control.clienteId,
            estabelecimentoId: control.estabelecimentoId,
            ambiente: control.ambiente,
            cnpjConsulta: control.cnpjConsulta,
            xml: document.xml
          });
          savedInExecution += 1;
          if (document.nsu > cursor) cursor = document.nsu;
        }
      } catch (error) {
        await this.stopAfterError(id, leaseUntil, error);
        return;
      }

      const shouldContinue = result.cStat === '118' && result.documentos.length === NfceScService.BATCH_SIZE;
      if (shouldContinue && cursor <= control.ultimoNsuConsultado) {
        await this.stopAfterError(
          id,
          leaseUntil,
          new Error('A SEF/SC retornou um lote completo sem avancar o NSU; consulta interrompida para evitar repetir o mesmo lote.')
        );
        return;
      }

      const authFailure = result.cStat === '8002' || result.cStat === '8004';
      const certificateFailure = ['280', '281', '282', '283', '284', '285', '286'].includes(result.cStat);
      const status = authFailure
        ? NfeSyncStatus.erro_autorizacao
        : certificateFailure
          ? NfeSyncStatus.erro_certificado
          : ['117', '118'].includes(result.cStat)
            ? NfeSyncStatus.ativo
            : NfeSyncStatus.erro_api;
      const completed = result.cStat === '117' || (result.cStat === '118' && result.documentos.length < NfceScService.BATCH_SIZE);
      const retryOneHour = result.cStat !== '117' && result.cStat !== '118';
      const now = new Date();
      const next = shouldContinue
        ? this.newLease()
        : retryOneHour
          ? new Date(now.getTime() + 60 * 60 * 1000)
          : completed
            ? new Date(now.getTime() + 12 * 60 * 60 * 1000)
            : new Date(now.getTime() + 60 * 60 * 1000);
      const message = shouldContinue
        ? `SEF/SC ${result.cStat}: lote de ${result.documentos.length} documento(s) salvo. Continuando automaticamente; ${savedInExecution} documento(s) nesta execucao, NSU ${cursor}.`
        : `SEF/SC ${result.cStat}: ${result.xMotivo}. ${savedInExecution} documento(s) armazenado(s) nesta execucao. NSU ${cursor}.`;
      const errorDiagnosticUpdate = result.cStat === '9999' && result.errorDiagnostic
        ? {
          diagnosticoXmlRequisicao: result.errorDiagnostic.requestXml,
          diagnosticoXmlResposta: result.errorDiagnostic.responseXml,
          diagnosticoXmlCriadoEm: now
        }
        : {};
      const updated = await this.prisma.nfceScSyncControle.updateMany({
        where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
        data: {
          status: shouldContinue ? NfeSyncStatus.processando : status,
          ultimoNsuConsultado: cursor,
          ultimaExecucao: now,
          proximaExecucao: next,
          totalDocumentosBaixados: { increment: result.documentos.length },
          ultimaMensagem: message,
          ...errorDiagnosticUpdate
        }
      });
      if (!updated.count) return;
      if (!shouldContinue) return;
      leaseUntil = next;
    }
  }

  private async stopAfterError(id: string, leaseUntil: Date, error: unknown): Promise<void> {
    const message = this.toErrorMessage(error);
    const certificateError = /certificado|pfx|tls|handshake/i.test(message);
    await this.prisma.nfceScSyncControle.updateMany({
      where: { id, status: NfeSyncStatus.processando, proximaExecucao: leaseUntil },
      data: {
        status: certificateError ? NfeSyncStatus.erro_certificado : NfeSyncStatus.erro_api,
        ultimaExecucao: new Date(),
        proximaExecucao: new Date(Date.now() + 60 * 60 * 1000),
        ultimaMensagem: message
      }
    });
    this.logger.warn(`Sincronismo NFC-e SC ${id} interrompido: ${message}`);
  }

  private async resumeExpiredExecutions(): Promise<void> {
    try {
      const now = new Date();
      const expiredRecoveries = await this.prisma.nfceScSyncControle.findMany({
        where: {
          status: { not: NfeSyncStatus.processando },
          reprocessamentoStatus: NfceScRecoveryStatus.processando,
          reprocessamentoLease: { lte: now }
        },
        select: { id: true, reprocessamentoLease: true }
      });
      for (const { id, reprocessamentoLease } of expiredRecoveries) {
        if (this.runningControls.has(id) || !reprocessamentoLease) continue;
        const leaseUntil = this.newLease();
        const claimed = await this.prisma.nfceScSyncControle.updateMany({
          where: {
            id,
            status: { not: NfeSyncStatus.processando },
            reprocessamentoStatus: NfceScRecoveryStatus.processando,
            reprocessamentoLease: { lte: now }
          },
          data: {
            reprocessamentoLease: leaseUntil,
            proximaExecucao: leaseUntil,
            reprocessamentoMensagem: 'Retomando automaticamente o reprocessamento de NSUs a partir do ultimo cursor salvo.'
          }
        });
        if (claimed.count) this.startBackgroundRecovery(id, leaseUntil);
      }

      const expired = await this.prisma.nfceScSyncControle.findMany({
        where: { status: NfeSyncStatus.processando, proximaExecucao: { lte: now } },
        select: { id: true }
      });
      for (const { id } of expired) {
        if (this.runningControls.has(id)) continue;
        const leaseUntil = this.newLease();
        const claimed = await this.prisma.nfceScSyncControle.updateMany({
          where: { id, status: NfeSyncStatus.processando, proximaExecucao: { lte: now } },
          data: {
            proximaExecucao: leaseUntil,
            ultimaMensagem: 'Retomando automaticamente a consulta SEF/SC a partir do ultimo NSU salvo.'
          }
        });
        if (claimed.count) this.startBackgroundExecution(id, leaseUntil);
      }
    } catch (error) {
      this.logger.warn(`Nao foi possivel verificar consultas NFC-e SC pendentes: ${this.toErrorMessage(error)}`);
    }
  }

  private newLease(): Date {
    return new Date(Date.now() + NfceScService.EXECUTION_LEASE_MS);
  }

  private sameDate(left: Date | null, right: Date): boolean {
    return left instanceof Date && left.getTime() === right.getTime();
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
