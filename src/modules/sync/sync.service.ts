import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Ambiente, Certificado, ClienteEstabelecimento, DocumentoOrigem, Prisma, SyncMode, SyncStatus } from '@prisma/client';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { AdnDFeResult, NFSE_ADN_CLIENT, NfseAdnClient } from '../../integrations/nfse-adn/nfse-adn.types';
import { NfseDanfseService } from '../nfse/nfse-danfse.service';
import { NfseXmlParserService } from '../nfse/nfse-xml-parser.service';
import { LocalStorageService } from '../storage/storage.service';
import { TestSingleNsuDto } from './dto/test-single-nsu.dto';

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private autoSyncRunning = false;
  private readonly autoSyncEnabled = process.env.SYNC_AUTO_RUN_ENABLED !== 'false';
  private readonly autoSyncIntervalMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_INTERVAL_MS', 30000);
  private readonly autoSyncStartupDelayMs = this.parsePositiveNumberEnv('SYNC_AUTO_RUN_STARTUP_DELAY_MS', 3000);
  private readonly apiRetryDelayMs = this.parsePositiveNumberEnv('SYNC_API_RETRY_DELAY_MS', 60000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly danfse: NfseDanfseService,
    private readonly parser: NfseXmlParserService,
    @Inject(NFSE_ADN_CLIENT) private readonly adnClient: NfseAdnClient
  ) {}

  onModuleInit(): void {
    if (!this.autoSyncEnabled) {
      this.logger.log('Execucao automatica de sync desativada (SYNC_AUTO_RUN_ENABLED=false)');
      return;
    }

    this.autoSyncTimer = setInterval(() => {
      void this.runAutomaticSyncCycle();
    }, this.autoSyncIntervalMs);

    setTimeout(() => {
      void this.runAutomaticSyncCycle();
    }, this.autoSyncStartupDelayMs);

    this.logger.log(`Execucao automatica de sync habilitada a cada ${this.autoSyncIntervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (!this.autoSyncTimer) {
      return;
    }

    clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
  }

  async iniciarSync(clienteId: string): Promise<{ controlesCriadosOuAtualizados: number }> {
    await this.ensureClient(clienteId);

    const establishments = await this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId, ativo: true }
    });

    for (const establishment of establishments) {
      await this.prisma.nfseSyncControle.upsert({
        where: {
          cnpjConsulta_ambiente: {
            cnpjConsulta: establishment.cnpj,
            ambiente: Ambiente.producao
          }
        },
        update: {
          status: SyncStatus.ativo,
          ultimaMensagem: 'Sincronizacao ativada manualmente'
        },
        create: {
          clienteId,
          estabelecimentoId: establishment.id,
          cnpjConsulta: establishment.cnpj,
          ambiente: Ambiente.producao,
          ultimoNsuConsultado: BigInt(0),
          ultimoNsuComDocumento: BigInt(0),
          nsuInicial: BigInt(1),
          modoSync: SyncMode.historico_desde_nsu_1,
          status: SyncStatus.ativo
        }
      });
    }

    await this.runNow();

    return { controlesCriadosOuAtualizados: establishments.length };
  }

  async pausarSync(clienteId: string): Promise<{ total: number }> {
    await this.ensureClient(clienteId);
    const result = await this.prisma.nfseSyncControle.updateMany({
      where: { clienteId },
      data: {
        status: SyncStatus.pausado,
        ultimaMensagem: 'Sincronizacao pausada manualmente'
      }
    });

    return { total: result.count };
  }

  async retomarSync(clienteId: string): Promise<{ total: number }> {
    await this.ensureClient(clienteId);
    const result = await this.prisma.nfseSyncControle.updateMany({
      where: { clienteId },
      data: {
        status: SyncStatus.ativo,
        ultimaMensagem: 'Sincronizacao retomada manualmente'
      }
    });

    return { total: result.count };
  }

  async statusSync(clienteId: string) {
    await this.ensureClient(clienteId);

    const controles = await this.prisma.nfseSyncControle.findMany({
      where: { clienteId },
      orderBy: { updatedAt: 'desc' }
    });

    const logs = await this.prisma.nfseSyncLog.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return { controles, logs };
  }

  async runNow(): Promise<{ processed: number; documentsSaved: number }> {
    const now = new Date();
    const controls = await this.prisma.nfseSyncControle.findMany({
      where: {
        status: SyncStatus.ativo,
        OR: [{ proximaExecucao: null }, { proximaExecucao: { lte: now } }]
      },
      include: {
        estabelecimento: true
      },
      take: 50
    });

    let documentsSaved = 0;

    for (const control of controls) {
      const certificate = await this.prisma.certificado.findFirst({
        where: {
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ativo: true
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!certificate) {
        await this.logSync(control.clienteId, control.id, null, control.ambiente, null, 'erro_certificado', 'Nenhum certificado ativo para o estabelecimento');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            status: SyncStatus.erro_certificado,
            ultimaMensagem: 'Nenhum certificado ativo encontrado',
            ultimaExecucao: new Date()
          }
        });
        continue;
      }

      if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
        await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, null, 'erro_certificado', 'Certificado vencido');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            status: SyncStatus.erro_certificado,
            ultimaMensagem: 'Certificado vencido',
            ultimaExecucao: new Date()
          }
        });
        continue;
      }

      const nextNsu = control.ultimoNsuConsultado + BigInt(1);

      const result = await this.adnClient.getDFeByNsu({
        cnpjConsulta: control.cnpjConsulta,
        nsu: nextNsu,
        ambiente:
          control.ambiente === Ambiente.producao
            ? NfseAmbiente.PRODUCAO
            : NfseAmbiente.PRODUCAO_RESTRITA,
        certificateId: certificate.id
      });

      if (this.mustRetryWithoutAdvancingNsu(result)) {
        const retryAt = new Date(Date.now() + this.apiRetryDelayMs);
        await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'erro_api', result.message ?? 'Falha temporaria ao consultar ADN');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            ultimaExecucao: new Date(),
            proximaExecucao: retryAt,
            ultimaMensagem: result.message ?? 'Falha temporaria ao consultar ADN; nova tentativa agendada'
          }
        });
        continue;
      }

      if (!result.hasDocument || !result.xml || !result.chaveAcesso) {
        await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'sem_documento', result.message ?? 'Sem documento para o NSU');
        await this.prisma.nfseSyncControle.update({
          where: { id: control.id },
          data: {
            ultimoNsuConsultado: nextNsu,
            ultimaExecucao: new Date(),
            proximaExecucao: null,
            ultimaMensagem: result.message ?? 'Sem documento para o NSU informado'
          }
        });
        continue;
      }

      const chave = result.chaveAcesso;
      let parsedXml: ReturnType<NfseXmlParserService['parse']> | null = null;
      try {
        parsedXml = this.parser.parse(result.xml);
      } catch (error) {
        this.logger.warn(`Falha ao parsear XML da chave ${chave}: ${this.toErrorMessage(error)}`);
      }

      const dataReferencia = parsedXml?.dataEmissao ?? new Date();
      const competencia =
        parsedXml?.competencia ??
        (parsedXml?.dataEmissao
          ? new Date(Date.UTC(parsedXml.dataEmissao.getUTCFullYear(), parsedXml.dataEmissao.getUTCMonth(), 1))
          : undefined);
      const year = dataReferencia.getUTCFullYear();
      const month = String(dataReferencia.getUTCMonth() + 1).padStart(2, '0');
      const cnpjPasta =
        this.normalizeCnpj(parsedXml?.cnpjPrestador) ??
        this.normalizeCnpj(parsedXml?.cnpjTomador) ??
        control.cnpjConsulta;
      const xmlKey = `nfse/${control.ambiente}/${cnpjPasta}/${year}/${month}/xml/${chave}.xml`;
      await this.storage.putObject(xmlKey, result.xml);
      const danfseKey = `nfse/${control.ambiente}/${cnpjPasta}/${year}/${month}/danfse/${chave}.pdf`;
      const danfsePdf = this.danfse.generateFromXml(result.xml, {
        chaveAcesso: chave,
        numeroNfse: parsedXml?.numeroNfse,
        dataEmissao: parsedXml?.dataEmissao,
        status: this.normalizeStatus(parsedXml?.status),
        cnpjPrestador: parsedXml?.cnpjPrestador ?? control.cnpjConsulta,
        razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
        cnpjTomador: parsedXml?.cnpjTomador,
        razaoSocialTomador: parsedXml?.razaoSocialTomador,
        valorServico: parsedXml?.valorServico,
        descricaoServico: parsedXml?.descricaoServico
      });
      await this.storage.putObject(danfseKey, danfsePdf);
      const hash = this.parser.getHash(result.xml);

      await this.prisma.nfseDocumento.upsert({
        where: {
          ambiente_chaveAcesso: {
            ambiente: control.ambiente,
            chaveAcesso: chave
          }
        },
        update: {
          nsu: nextNsu,
          numeroNfse: parsedXml?.numeroNfse,
          serie: parsedXml?.serie,
          dataEmissao: parsedXml?.dataEmissao,
          competencia,
          status: this.normalizeStatus(parsedXml?.status) ?? 'autorizada',
          cnpjPrestador: parsedXml?.cnpjPrestador ?? control.cnpjConsulta,
          razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
          cnpjTomador: parsedXml?.cnpjTomador,
          razaoSocialTomador: parsedXml?.razaoSocialTomador,
          municipioPrestacaoCodigo: parsedXml?.municipioPrestacaoCodigo,
          municipioPrestacaoNome: parsedXml?.municipioPrestacaoNome,
          valorServico: this.toDecimal(parsedXml?.valorServico),
          valorDeducoes: this.toDecimal(parsedXml?.valorDeducoes),
          valorIss: this.toDecimal(parsedXml?.valorIss),
          aliquotaIss: this.toDecimal(parsedXml?.aliquotaIss),
          codigoServicoNacional: parsedXml?.codigoServicoNacional,
          itemListaServico: parsedXml?.itemListaServico,
          descricaoServico: parsedXml?.descricaoServico,
          xmlPath: xmlKey,
          danfsePath: danfseKey,
          hashXml: hash,
          origem: DocumentoOrigem.adn_nsu,
          updatedAt: new Date()
        },
        create: {
          clienteId: control.clienteId,
          estabelecimentoId: control.estabelecimentoId,
          ambiente: control.ambiente,
          nsu: nextNsu,
          chaveAcesso: chave,
          numeroNfse: parsedXml?.numeroNfse,
          serie: parsedXml?.serie,
          dataEmissao: parsedXml?.dataEmissao,
          competencia,
          status: this.normalizeStatus(parsedXml?.status) ?? 'autorizada',
          cnpjPrestador: parsedXml?.cnpjPrestador ?? control.cnpjConsulta,
          razaoSocialPrestador: parsedXml?.razaoSocialPrestador,
          cnpjTomador: parsedXml?.cnpjTomador,
          razaoSocialTomador: parsedXml?.razaoSocialTomador,
          municipioPrestacaoCodigo: parsedXml?.municipioPrestacaoCodigo,
          municipioPrestacaoNome: parsedXml?.municipioPrestacaoNome,
          valorServico: this.toDecimal(parsedXml?.valorServico),
          valorDeducoes: this.toDecimal(parsedXml?.valorDeducoes),
          valorIss: this.toDecimal(parsedXml?.valorIss),
          aliquotaIss: this.toDecimal(parsedXml?.aliquotaIss),
          codigoServicoNacional: parsedXml?.codigoServicoNacional,
          itemListaServico: parsedXml?.itemListaServico,
          descricaoServico: parsedXml?.descricaoServico,
          xmlPath: xmlKey,
          danfsePath: danfseKey,
          hashXml: hash,
          origem: DocumentoOrigem.adn_nsu
        }
      });

      await this.prisma.nfseSyncControle.update({
        where: { id: control.id },
        data: {
          ultimoNsuConsultado: nextNsu,
          ultimoNsuComDocumento: nextNsu,
          totalDocumentosBaixados: {
            increment: 1
          },
          ultimaExecucao: new Date(),
          proximaExecucao: null,
          ultimaMensagem: 'Documento sincronizado com sucesso'
        }
      });

      await this.logSync(control.clienteId, control.id, certificate.id, control.ambiente, nextNsu, 'sucesso', 'Documento sincronizado');
      documentsSaved += 1;
    }

    return {
      processed: controls.length,
      documentsSaved
    };
  }

  async testSingleNsu(dto: TestSingleNsuDto): Promise<{
    clienteId: string;
    estabelecimentoId: string;
    ambiente: Ambiente;
    cnpjConsulta: string;
    nsu: string;
    hasDocument: boolean;
    chaveAcesso: string | null;
    statusCode: number;
    message: string | null;
    xml: string | null;
    rawResponse: unknown;
  }> {
    await this.ensureClient(dto.clienteId);
    const establishment = await this.ensureEstablishmentBelongsToClient(dto.clienteId, dto.estabelecimentoId);
    const certificate = await this.findUsableCertificate(dto.clienteId, dto.estabelecimentoId);
    const nsu = this.parseNsu(dto.nsu);
    const ambiente = dto.ambiente === 'producao_restrita' ? Ambiente.producao_restrita : Ambiente.producao;

    const result = await this.adnClient.getDFeByNsu({
      cnpjConsulta: establishment.cnpj,
      nsu,
      ambiente: this.toNfseAmbiente(ambiente),
      certificateId: certificate.id
    });

    return {
      clienteId: dto.clienteId,
      estabelecimentoId: dto.estabelecimentoId,
      ambiente,
      cnpjConsulta: establishment.cnpj,
      nsu: nsu.toString(),
      hasDocument: result.hasDocument,
      chaveAcesso: result.chaveAcesso ?? null,
      statusCode: result.statusCode,
      message: result.message ?? null,
      xml: result.xml ?? null,
      rawResponse: result.rawResponse
    };
  }

  async listLogs() {
    return this.prisma.nfseSyncLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }

  private async ensureClient(clienteId: string): Promise<void> {
    const client = await this.prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!client) {
      throw new NotFoundException('Cliente nao encontrado');
    }
  }

  private async ensureEstablishmentBelongsToClient(
    clienteId: string,
    estabelecimentoId: string
  ): Promise<ClienteEstabelecimento> {
    const establishment = await this.prisma.clienteEstabelecimento.findUnique({
      where: { id: estabelecimentoId }
    });

    if (!establishment || establishment.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado para o cliente informado');
    }

    if (!establishment.ativo) {
      throw new BadRequestException('Estabelecimento inativo');
    }

    return establishment;
  }

  private async findUsableCertificate(clienteId: string, estabelecimentoId: string): Promise<Certificado> {
    const certificate = await this.prisma.certificado.findFirst({
      where: {
        clienteId,
        estabelecimentoId,
        ativo: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!certificate) {
      throw new BadRequestException('Nenhum certificado ativo para o estabelecimento');
    }

    if (certificate.validadeFim && certificate.validadeFim.getTime() < Date.now()) {
      throw new BadRequestException('Certificado vencido');
    }

    return certificate;
  }

  private parseNsu(value: string): bigint {
    try {
      const nsu = BigInt(value);
      if (nsu < 0n) {
        throw new BadRequestException('NSU deve ser maior ou igual a zero');
      }

      return nsu;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('NSU invalido');
    }
  }

  private toNfseAmbiente(ambiente: Ambiente): NfseAmbiente {
    return ambiente === Ambiente.producao ? NfseAmbiente.PRODUCAO : NfseAmbiente.PRODUCAO_RESTRITA;
  }

  private async runAutomaticSyncCycle(): Promise<void> {
    if (this.autoSyncRunning) {
      return;
    }

    this.autoSyncRunning = true;
    try {
      await this.runNow();
    } catch (error) {
      this.logger.error(`Falha na execucao automatica de sync: ${this.toErrorMessage(error)}`);
    } finally {
      this.autoSyncRunning = false;
    }
  }

  private mustRetryWithoutAdvancingNsu(result: AdnDFeResult): boolean {
    if (result.hasDocument) {
      return false;
    }

    if (result.statusCode === 429 || result.statusCode === 0) {
      return true;
    }

    return result.statusCode >= 500;
  }

  private parsePositiveNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private toDecimal(value?: string): Prisma.Decimal | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim();
    const sanitized =
      normalized.includes(',') && normalized.includes('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(',', '.');

    if (!/^-?\d+(\.\d+)?$/.test(sanitized)) {
      return undefined;
    }

    return new Prisma.Decimal(sanitized);
  }

  private normalizeStatus(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    if (normalized === '100') {
      return 'autorizada';
    }

    if (normalized === '101') {
      return 'cancelada';
    }

    return normalized;
  }

  private normalizeCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private async logSync(
    clienteId: string,
    controleSyncId: string,
    certificadoId: string | null,
    ambiente: Ambiente,
    nsu: bigint | null,
    status: string,
    mensagem: string
  ): Promise<void> {
    await this.prisma.nfseSyncLog.create({
      data: {
        clienteId,
        controleSyncId,
        certificadoId,
        ambiente,
        nsuConsultado: nsu,
        status,
        mensagem
      }
    });
  }
}
