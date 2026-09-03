import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AlertResolution, Prisma } from '@prisma/client';
import { DominioEmpresaEnderecoRecord } from '../../integrations/dominio-nfe/dominio-nfe.types';
import { RealDominioNfeClient } from '../../integrations/dominio-nfe/real-dominio-nfe.client';
import { PrismaService } from '../../prisma/prisma.service';
import { NfeXmlParserService, type ParsedNfe } from '../nfe/nfe-xml-parser.service';
import { NfseDanfseService } from '../nfse/nfse-danfse.service';
import { LocalStorageService } from '../storage/storage.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { AlertResolutionResponseDto } from './dto/alert-resolution-response.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { UpdateAlertResolutionDto } from './dto/update-alert-resolution.dto';

type CteDesacordoAlertRow = Prisma.NfeEventoGetPayload<{
  include: {
    cteDesacordoResolucao: true;
    nfeDocumento: {
      include: {
        cliente: true;
      };
    };
  };
}>;

type NfseRetencaoAlertRow = Prisma.NfseDocumentoGetPayload<{
  include: {
    cliente: true;
    estabelecimento: true;
  };
}>;

type NfeEnderecoDivergenteAlertRow = Prisma.NfeDocumentoGetPayload<{
  include: {
    cliente: true;
    estabelecimento: true;
  };
}>;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly nfseDanfse: NfseDanfseService,
    private readonly nfeXmlParser: NfeXmlParserService,
    @Optional() private readonly dominioNfeClient?: RealDominioNfeClient
  ) {}

  async findAll(query: QueryAlertsDto = {}): Promise<AlertResponseDto[]> {
    const [cteRows, nfseRows, nfeRows] = await Promise.all([
      this.prisma.nfeEvento.findMany({
        where: {
          nfeDocumento: {
            modelo: '57',
            ...(query.clienteId ? { clienteId: query.clienteId } : {})
          },
          descricao: {
            contains: 'desacordo',
            mode: 'insensitive'
          }
        },
        include: {
          cteDesacordoResolucao: true,
          nfeDocumento: {
            include: {
              cliente: true
            }
          }
        },
        orderBy: [{ dataEvento: 'desc' }, { createdAt: 'desc' }]
      }),
      this.prisma.nfseDocumento.findMany({
        where: {
          ...(query.clienteId ? { clienteId: query.clienteId } : {}),
          xmlPath: { not: null },
          cnpjTomador: { not: null },
          dataCancelamento: null,
        },
        include: {
          cliente: true,
          estabelecimento: true
        },
        orderBy: [{ dataEmissao: 'desc' }, { updatedAt: 'desc' }]
      }),
      this.prisma.nfeDocumento.findMany({
        where: {
          ...(query.clienteId ? { clienteId: query.clienteId } : {}),
          tipoRelacao: 'recebida',
          NOT: { status: 'Cancelada' },
          OR: [{ xmlCompletoPath: { not: null } }, { xmlResumoPath: { not: null } }]
        },
        include: {
          cliente: true,
          estabelecimento: true
        },
        orderBy: [{ dataEmissao: 'desc' }, { updatedAt: 'desc' }]
      })
    ]);

    const dominioAddresses = await this.loadDominioAddresses(nfeRows);
    const cteAlerts = cteRows.filter((row) => this.isDesacordoEvent(row)).map((row) => this.toCteAlertDto(row));
    const nfseAlertsRaw = await Promise.all(nfseRows.map((row) => this.toNfseRetentionAlertDto(row)));
    const nfeAddressAlertsRaw = await Promise.all(
      nfeRows.map((row) =>
        this.toNfeEnderecoDivergenteAlertDto(row, {
          ...(row.estabelecimento || {}),
          ...(dominioAddresses.get(this.normalizeDigits(row.estabelecimento?.cnpj)) || {})
        })
      )
    );
    const alerts = [
      ...cteAlerts,
      ...nfseAlertsRaw.filter((row): row is AlertResponseDto => Boolean(row)),
      ...nfeAddressAlertsRaw.filter((row): row is AlertResponseDto => Boolean(row))
    ];

    await this.applyGenericResolutionState(alerts);

    return alerts
      .filter((alert) => this.matchesStatusFilter(alert, query.status))
      .sort((left, right) => Date.parse(right.dataHora || '') - Date.parse(left.dataHora || ''));
  }

  async updateCteDesacordoResolution(eventId: string, resolved: boolean): Promise<AlertResponseDto> {
    const event = await this.prisma.nfeEvento.findUnique({
      where: { id: eventId },
      include: {
        cteDesacordoResolucao: true,
        nfeDocumento: {
          include: {
            cliente: true
          }
        }
      }
    });

    if (!event || event.nfeDocumento.modelo !== '57' || !this.isDesacordoEvent(event)) {
      throw new NotFoundException('Alerta de desacordo de CT-e nao encontrado');
    }

    if (resolved) {
      await this.prisma.cteDesacordoResolucao.upsert({
        where: { nfeEventoId: eventId },
        update: { resolvidoEm: new Date() },
        create: {
          nfeEventoId: eventId,
          resolvidoEm: new Date()
        }
      });
    } else {
      await this.prisma.cteDesacordoResolucao.deleteMany({
        where: { nfeEventoId: eventId }
      });
    }

    const refreshed = await this.prisma.nfeEvento.findUnique({
      where: { id: eventId },
      include: {
        cteDesacordoResolucao: true,
        nfeDocumento: {
          include: {
            cliente: true
          }
        }
      }
    });

    if (!refreshed) {
      throw new NotFoundException('Alerta de desacordo de CT-e nao encontrado');
    }

    return this.toCteAlertDto(refreshed);
  }

  async listResolutions(query: QueryAlertsDto = {}): Promise<AlertResolutionResponseDto[]> {
    const rows = await this.prisma.alertResolution.findMany({
      where: query.clienteId ? { clienteId: query.clienteId } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 1000
    });

    return rows.map((row) => this.toResolutionDto(row));
  }

  async updateResolution(alertId: string, dto: UpdateAlertResolutionDto): Promise<AlertResolutionResponseDto> {
    if (!dto.resolvido) {
      await this.prisma.alertResolution.deleteMany({
        where: { alertId }
      });

      return {
        alertId,
        fingerprint: dto.fingerprint,
        clientId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: null
      };
    }

    const resolution = await this.prisma.alertResolution.upsert({
      where: { alertId },
      update: {
        fingerprint: dto.fingerprint,
        clienteId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: new Date()
      },
      create: {
        alertId,
        fingerprint: dto.fingerprint,
        clienteId: dto.clientId ?? null,
        origem: dto.origem ?? null,
        titulo: dto.titulo ?? null,
        resolvedAt: new Date()
      }
    });

    return this.toResolutionDto(resolution);
  }

  private toCteAlertDto(row: CteDesacordoAlertRow): AlertResponseDto {
    const numeroDocumento = String(row.nfeDocumento.numeroNfe || '').trim() || row.chaveAcesso;
    const eventoDescricao = String(row.descricao || 'Evento de desacordo').trim() || 'Evento de desacordo';

    return {
      id: `cte-desacordo-${row.id}`,
      eventId: row.id,
      severity: 'Atencao',
      tipo: 'CT-e',
      titulo: 'CT-e com evento de desacordo',
      descricao: `O CT-e ${numeroDocumento} recebeu o evento "${eventoDescricao}".`,
      clientId: row.nfeDocumento.clienteId,
      cliente: row.nfeDocumento.cliente?.razaoSocial || 'Cliente nao identificado',
      dataHora: (row.dataEvento ?? row.createdAt).toISOString(),
      status: row.cteDesacordoResolucao ? 'Resolvido' : 'Aberto',
      origem: 'cte-desacordo',
      mensagemTecnica: `Evento ${row.tipoEvento || 'desconhecido'} vinculado ao CT-e ${row.chaveAcesso}.`,
      sugestaoAcao: 'Conferir o desacordo com a empresa e validar se o CT-e precisa de tratamento operacional.',
      historicoTentativas: [],
      allowsReprocess: false,
      persistence: 'server',
      canToggleResolved: true,
      documentoId: row.nfeDocumentoId,
      chaveAcesso: row.chaveAcesso,
      numeroDocumento,
      eventoTipo: row.tipoEvento || '',
      eventoDescricao,
      resolvedAt: row.cteDesacordoResolucao?.resolvidoEm.toISOString() ?? null,
      emissor: row.nfeDocumento.cliente?.razaoSocial || 'Emissor nao identificado',
      retencoes: []
    };
  }

  private async toNfseRetentionAlertDto(row: NfseRetencaoAlertRow): Promise<AlertResponseDto | null> {
    if (!this.isNfseTomada(row)) {
      return null;
    }

    const xmlPath = String(row.xmlPath || '').trim();
    if (!xmlPath) {
      return null;
    }

    try {
      const xml = (await this.storage.getObject(xmlPath)).toString('utf8');
      const retentionData = this.nfseDanfse.extractRetentionAlertData(xml);
      if (!retentionData.hasRetention) {
        return null;
      }

      const numeroDocumento = String(row.numeroNfse || '').trim() || row.chaveAcesso;
      const emissor = String(row.razaoSocialPrestador || '').trim() || 'Emissor nao identificado';
      const retencoes = retentionData.entries.map((entry) => (entry.amount ? `${entry.label}: ${entry.amount}` : entry.label));
      const descricao =
        retencoes.length > 0
          ? `A NFS-e ${numeroDocumento} de entrada possui retencoes: ${retencoes.join(', ')}.`
          : `A NFS-e ${numeroDocumento} de entrada possui retencoes.`;

      return {
        id: `nfse-retencao-${row.id}`,
        eventId: row.id,
        severity: 'Atencao',
        tipo: 'NFS-e',
        titulo: 'NFS-e de entrada com retencao',
        descricao,
        clientId: row.clienteId,
        cliente: row.cliente?.razaoSocial || 'Cliente nao identificado',
        dataHora: (row.dataEmissao ?? row.updatedAt ?? row.createdAt).toISOString(),
        status: 'Aberto',
        origem: 'nfse-retencao-entrada',
        mensagemTecnica: `Prestador ${emissor}; chave ${row.chaveAcesso}.`,
        sugestaoAcao: 'Conferir as retencoes da NFS-e com a empresa e validar o tratamento fiscal e operacional.',
        historicoTentativas: [],
        allowsReprocess: false,
        persistence: 'client',
        canToggleResolved: true,
        documentoId: row.id,
        chaveAcesso: row.chaveAcesso,
        numeroDocumento,
        eventoTipo: '',
        eventoDescricao: '',
        resolvedAt: null,
        emissor,
        retencoes
      };
    } catch {
      return null;
    }
  }

  private async toNfeEnderecoDivergenteAlertDto(
    row: NfeEnderecoDivergenteAlertRow,
    comparisonEstablishment?: NfeEnderecoDivergenteAlertRow['estabelecimento'] | DominioEmpresaEnderecoRecord | null
  ): Promise<AlertResponseDto | null> {
    if (!this.isNfeEntradaTomada(row)) {
      return null;
    }

    const xmlPath = String(row.xmlCompletoPath || row.xmlResumoPath || '').trim();
    if (!xmlPath) {
      return null;
    }

    try {
      const xml = (await this.storage.getObject(xmlPath)).toString('utf8');
      const parsed = this.nfeXmlParser.parse(xml);
      if (!this.isNfeEnderecoComparisonEligible(parsed, comparisonEstablishment)) {
        return null;
      }

      const addressComparison = this.compareNfeAddress(parsed, comparisonEstablishment);
      if (!addressComparison.hasDifference) {
        return null;
      }

      const numeroDocumento = String(row.numeroNfe || '').trim() || row.chaveAcesso;
      const emissor = String(row.razaoSocialEmitente || '').trim() || 'Emissor nao identificado';
      const descricao = `A NF-e ${numeroDocumento} de entrada possui divergencias no endereco cadastral: ${addressComparison.labels.join(', ')}.`;

      return {
        id: `nfe-endereco-divergente-${row.id}`,
        eventId: row.id,
        severity: 'Atencao',
        tipo: 'NF-e',
        titulo: 'NF-e de entrada com endereco divergente',
        descricao,
        clientId: row.clienteId,
        cliente: row.cliente?.razaoSocial || 'Cliente nao identificado',
        dataHora: (row.dataEmissao ?? row.updatedAt ?? row.createdAt).toISOString(),
        status: 'Aberto',
        origem: 'nfe-endereco-divergente',
        mensagemTecnica: addressComparison.details.join(' | '),
        sugestaoAcao: 'Conferir o cadastro da empresa e solicitar ao fornecedor a correcao da NF-e de entrada.',
        historicoTentativas: [],
        allowsReprocess: false,
        persistence: 'client',
        canToggleResolved: true,
        documentoId: row.id,
        chaveAcesso: row.chaveAcesso,
        numeroDocumento,
        eventoTipo: '',
        eventoDescricao: '',
        resolvedAt: null,
        emissor,
        retencoes: []
      };
    } catch {
      return null;
    }
  }

  private async loadDominioAddresses(rows: NfeEnderecoDivergenteAlertRow[]): Promise<Map<string, DominioEmpresaEnderecoRecord>> {
    const cnpjs = [...new Set(rows.map((row) => this.normalizeDigits(row.estabelecimento?.cnpj)).filter(Boolean))];
    if (!this.dominioNfeClient || !cnpjs.length) {
      return new Map();
    }

    try {
      const records = await this.dominioNfeClient.listCompanyAddresses(cnpjs);
      return new Map(
        records
          .map((record) => [this.normalizeDigits(record.cnpjEmpresa), record] as const)
          .filter(([cnpj]) => Boolean(cnpj))
      );
    } catch {
      return new Map();
    }
  }

  private isDesacordoEvent(row: Pick<CteDesacordoAlertRow, 'descricao' | 'tipoEvento'>): boolean {
    const description = this.normalizeSearchText(row.descricao);
    const eventType = this.normalizeSearchText(row.tipoEvento);
    return description.includes('desacordo') || eventType.includes('desacordo');
  }

  private isNfseTomada(row: Pick<NfseRetencaoAlertRow, 'cnpjTomador' | 'estabelecimento'>): boolean {
    return this.normalizeDigits(row.cnpjTomador) === this.normalizeDigits(row.estabelecimento?.cnpj);
  }

  private isNfeEntradaTomada(row: Pick<NfeEnderecoDivergenteAlertRow, 'cnpjDestinatario' | 'estabelecimento' | 'tipoRelacao'>): boolean {
    return (
      row.tipoRelacao === 'recebida' &&
      this.normalizeDigits(row.cnpjDestinatario) === this.normalizeDigits(row.estabelecimento?.cnpj)
    );
  }

  private isNfeEnderecoComparisonEligible(
    parsed: Pick<
      ParsedNfe,
      | 'destinatarioEnderecoLogradouro'
      | 'destinatarioEnderecoBairro'
      | 'destinatarioEnderecoUf'
      | 'destinatarioEnderecoMunicipio'
      | 'destinatarioEnderecoCodigoMunicipio'
      | 'destinatarioEnderecoCep'
    >,
    establishment?: Pick<NonNullable<NfeEnderecoDivergenteAlertRow['estabelecimento']>, 'logradouro' | 'bairro' | 'uf' | 'municipioNome' | 'municipioCodigoIbge' | 'cep'> | DominioEmpresaEnderecoRecord | null
  ): boolean {
    const dominioEstablishment = establishment && 'municipio' in establishment ? establishment : null;
    const municipio = dominioEstablishment?.municipio ?? (establishment as { municipioNome?: string | null } | null | undefined)?.municipioNome;

    const comparableFields = [
      [establishment?.logradouro, parsed.destinatarioEnderecoLogradouro],
      [establishment?.bairro, parsed.destinatarioEnderecoBairro],
      [establishment?.uf, parsed.destinatarioEnderecoUf],
      [municipio, parsed.destinatarioEnderecoMunicipio],
      [establishment?.cep, parsed.destinatarioEnderecoCep]
    ];

    return comparableFields.some(([registered, documentValue]) => registered?.trim() && documentValue?.trim());
  }

  private compareNfeAddress(
    parsed: {
      destinatarioEnderecoLogradouro?: string | null;
      destinatarioEnderecoBairro?: string | null;
      destinatarioEnderecoUf?: string | null;
      destinatarioEnderecoMunicipio?: string | null;
      destinatarioEnderecoCodigoMunicipio?: string | null;
      destinatarioEnderecoCep?: string | null;
    },
    establishment?: {
      logradouro?: string | null;
      bairro?: string | null;
      uf?: string | null;
      municipioNome?: string | null;
      municipio?: string | null;
      municipioCodigoIbge?: string | null;
      cep?: string | null;
    } | null
  ): { hasDifference: boolean; labels: string[]; details: string[] } {
    const municipioCadastral = this.normalizeMunicipalityForComparison(establishment?.municipioNome || establishment?.municipio);
    const comparisons = [
      {
        label: 'logradouro',
        left: parsed.destinatarioEnderecoLogradouro,
        right: establishment?.logradouro,
        normalize: (value: string) => this.normalizeStreet(value)
      },
      {
        label: 'bairro',
        left: parsed.destinatarioEnderecoBairro,
        right: establishment?.bairro
      },
      {
        label: 'UF',
        left: parsed.destinatarioEnderecoUf,
        right: establishment?.uf,
        normalize: (value: string) => this.normalizeSearchText(value).toUpperCase()
      },
      {
        label: 'municipio',
        left: parsed.destinatarioEnderecoMunicipio,
        right: municipioCadastral,
        skip: this.sameMunicipalityCode(parsed.destinatarioEnderecoCodigoMunicipio, establishment?.municipioCodigoIbge)
      },
      {
        label: 'CEP',
        left: parsed.destinatarioEnderecoCep,
        right: establishment?.cep,
        normalize: (value: string) => this.normalizeDigits(value)
      }
    ];

    const labels: string[] = [];
    const details: string[] = [];

    for (const comparison of comparisons) {
      if (comparison.skip) {
        continue;
      }

      const left = this.normalizeAddressValue(comparison.left, comparison.normalize);
      const right = this.normalizeAddressValue(comparison.right, comparison.normalize);
      if (!left || !right) {
        continue;
      }

      if (left !== right) {
        labels.push(comparison.label);
        details.push(
          `${comparison.label}: NF-e="${String(comparison.left).trim()}" vs cadastro="${String(comparison.right).trim()}"`
        );
      }
    }

    return {
      hasDifference: labels.length > 0,
      labels,
      details
    };
  }

  private normalizeAddressValue(value?: string | null, customNormalize?: (value: string) => string): string {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }

    if (customNormalize) {
      return customNormalize(text).replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    return this.normalizeSearchText(text).replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  private normalizeStreet(value: string): string {
    return this.normalizeSearchText(value)
      .replace(/(?:,|\s+-?\s+)\s*(?:n[ºo]?\.?\s*)?\d+\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeMunicipality(value?: string | null): string {
    const text = String(value || '').trim();
    return this.normalizeSearchText(text) === 'mondais' ? 'Mondaí' : text;
  }

  private normalizeMunicipalityForComparison(value?: string | null): string {
    const text = String(value || '')
      .trim()
      .replace(/^\(\s*\d+\s*\)\s*/, '')
      .trim();
    return this.normalizeSearchText(text) === 'mondais' ? 'Mondai' : text;
  }

  private sameMunicipalityCode(documentCode?: string | null, registeredCode?: string | null): boolean {
    const documentDigits = this.normalizeDigits(documentCode);
    const registeredDigits = this.normalizeDigits(registeredCode);
    return Boolean(documentDigits && registeredDigits && documentDigits === registeredDigits);
  }

  private async applyGenericResolutionState(alerts: AlertResponseDto[]): Promise<void> {
    const genericAlerts = alerts.filter((alert) => String(alert.persistence || '').toLowerCase() !== 'server');
    const alertIds = genericAlerts.map((alert) => alert.id).filter(Boolean);
    if (!alertIds.length) {
      return;
    }

    const resolutions = await this.prisma.alertResolution.findMany({
      where: {
        alertId: {
          in: alertIds
        }
      }
    });
    const resolutionById = new Map(resolutions.map((resolution) => [resolution.alertId, resolution]));

    genericAlerts.forEach((alert) => {
      const resolution = resolutionById.get(alert.id);
      if (!resolution) {
        return;
      }

      const fingerprint = this.buildGenericAlertFingerprint(alert);
      if (resolution.fingerprint !== fingerprint) {
        return;
      }

      alert.status = 'Resolvido';
      alert.resolvedAt = resolution.resolvedAt?.toISOString() ?? resolution.updatedAt.toISOString();
    });
  }

  private matchesStatusFilter(alert: AlertResponseDto, status?: QueryAlertsDto['status']): boolean {
    if (!status || status === 'Todos') {
      return true;
    }
    return alert.status === status;
  }

  private buildGenericAlertFingerprint(alert: AlertResponseDto): string {
    return JSON.stringify([
      alert.id,
      alert.origem || '',
      alert.dataHora || '',
      alert.titulo || '',
      alert.descricao || '',
      alert.mensagemTecnica || ''
    ]);
  }

  private normalizeSearchText(value?: string | null): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private normalizeDigits(value?: string | null): string {
    return String(value || '').replace(/\D/g, '');
  }

  private toResolutionDto(row: AlertResolution): AlertResolutionResponseDto {
    return {
      alertId: row.alertId,
      fingerprint: row.fingerprint,
      clientId: row.clienteId,
      origem: row.origem,
      titulo: row.titulo,
      resolvedAt: row.resolvedAt?.toISOString() ?? null
    };
  }
}
