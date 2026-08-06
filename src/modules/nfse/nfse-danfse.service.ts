import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

export interface DanfseRenderInput {
  chaveAcesso: string;
  ambiente?: string | null;
  tipoAmbiente?: string | null;
  ambienteGerador?: string | null;
  numeroNfse?: string | null;
  serie?: string | null;
  numeroDps?: string | null;
  serieDps?: string | null;
  dataEmissao?: Date | null;
  dataEmissaoDps?: Date | null;
  competencia?: Date | null;
  status?: string | null;
  emitenteNfse?: string | null;
  finalidade?: string | null;
  codigoVerificacao?: string | null;
  cnpjPrestador?: string | null;
  razaoSocialPrestador?: string | null;
  inscricaoMunicipalPrestador?: string | null;
  telefonePrestador?: string | null;
  enderecoPrestador?: string | null;
  municipioPrestador?: string | null;
  codigoIbgeCepPrestador?: string | null;
  emailPrestador?: string | null;
  simplesNacional?: string | null;
  regimeApuracaoSn?: string | null;
  cnpjTomador?: string | null;
  razaoSocialTomador?: string | null;
  inscricaoMunicipalTomador?: string | null;
  telefoneTomador?: string | null;
  enderecoTomador?: string | null;
  municipioTomador?: string | null;
  codigoIbgeCepTomador?: string | null;
  emailTomador?: string | null;
  cnpjDestinatario?: string | null;
  razaoSocialDestinatario?: string | null;
  telefoneDestinatario?: string | null;
  enderecoDestinatario?: string | null;
  municipioDestinatario?: string | null;
  codigoIbgeCepDestinatario?: string | null;
  emailDestinatario?: string | null;
  cnpjIntermediario?: string | null;
  razaoSocialIntermediario?: string | null;
  inscricaoMunicipalIntermediario?: string | null;
  telefoneIntermediario?: string | null;
  enderecoIntermediario?: string | null;
  municipioIntermediario?: string | null;
  codigoIbgeCepIntermediario?: string | null;
  emailIntermediario?: string | null;
  municipioPrestacaoCodigo?: string | null;
  municipioPrestacaoNome?: string | null;
  localPrestacao?: string | null;
  valorServico?: string | null;
  valorDeducoes?: string | null;
  valorDescontoIncondicionado?: string | null;
  valorDescontoCondicionado?: string | null;
  valorTotalRetencoes?: string | null;
  valorLiquidoNfse?: string | null;
  valorTotalIbscbs?: string | null;
  valorLiquidoComIbscbs?: string | null;
  valorIss?: string | null;
  valorIssRetido?: string | null;
  baseCalculoIss?: string | null;
  retencaoIss?: string | null;
  aliquotaIss?: string | null;
  tipoTributacaoIssqn?: string | null;
  municipioIncidenciaIssqn?: string | null;
  regimeEspecialTributacaoIssqn?: string | null;
  tipoImunidadeIssqn?: string | null;
  suspensaoExigibilidadeIssqn?: string | null;
  numeroProcessoSuspensaoIssqn?: string | null;
  beneficioMunicipal?: string | null;
  calculoBeneficioMunicipal?: string | null;
  valorIrrf?: string | null;
  valorContribuicaoPrevidenciaria?: string | null;
  valorContribuicoesSociais?: string | null;
  valorPis?: string | null;
  valorCofins?: string | null;
  descricaoContribuicoesSociais?: string | null;
  cstClassTribIbsCbs?: string | null;
  indicadorOperacaoIbsCbs?: string | null;
  municipioIncidenciaIbsCbs?: string | null;
  exclusoesReducoesBcIbsCbs?: string | null;
  baseCalculoAposExclusoesIbsCbs?: string | null;
  reducaoAliquotaIbs?: string | null;
  reducaoAliquotaCbs?: string | null;
  aliquotaIbsEstadualMunicipal?: string | null;
  aliquotaEfetivaIbsMunicipal?: string | null;
  valorApuradoIbsMunicipal?: string | null;
  aliquotaEfetivaIbsEstadual?: string | null;
  valorApuradoIbsEstadual?: string | null;
  valorTotalApuradoIbs?: string | null;
  aliquotaCbs?: string | null;
  aliquotaEfetivaCbs?: string | null;
  valorTotalApuradoCbs?: string | null;
  codigoServicoNacional?: string | null;
  codigoServicoMunicipal?: string | null;
  codigoNbs?: string | null;
  descricaoCodigoTributacao?: string | null;
  itemListaServico?: string | null;
  descricaoServico?: string | null;
  infoComplementares?: string | null;
  chaveNfseSubstituida?: string | null;
  documentoReferencia?: string | null;
  codigoObra?: string | null;
  inscricaoImobiliaria?: string | null;
  codigoEvento?: string | null;
  documentoTecnico?: string | null;
  numeroPedido?: string | null;
  itemPedido?: string | null;
  infoAdministracaoMunicipal?: string | null;
  totaisAproximadosTributos?: string | null;
}

export interface NfseRetentionAlertEntry {
  code: 'iss' | 'irrf' | 'inss' | 'csll' | 'pis' | 'cofins';
  label: string;
  amount?: string;
}

export interface NfseRetentionAlertData {
  hasRetention: boolean;
  entries: NfseRetentionAlertEntry[];
}

export interface NfseLeituraFiscal {
  layout: 'padrao_nacional' | 'abrasf' | 'desconhecido';
  localPrestacao?: string;
  localIncidenciaIss?: string;
  valorServico?: string;
  valorLiquidoNfse?: string;
  valorTotalRetencoes?: string;
  valorIss?: string;
  valorIssRetido?: string;
  valorIssRetidoReal?: string;
  valorIrrf?: string;
  valorInss?: string;
  valorCsll?: string;
  valorPis?: string;
  valorCofins?: string;
  aliquotaIss?: string;
  aliquotaRealIss?: string;
  retencaoIss?: string;
  retencaoFederal?: 'Retido' | 'Normal';
  totalRetencoesFederais?: string;
  statusProcessamento: 'OK' | 'Erro';
  erroProcessamento?: string;
  camposComProblema: string[];
  retencoes: NfseRetentionAlertEntry[];
}

type PdfFont = '/F1' | '/F2';

interface PdfField {
  label?: string;
  value: string;
  span?: number;
}

interface PdfSection {
  title: string;
  columns: number;
  fields: PdfField[];
}

interface PdfPageState {
  commands: string[];
  page: { width: number; height: number };
  margin: number;
  contentX: number;
  contentWidth: number;
  bottomY: number;
  yTop: number;
  pageNumber: number;
}

@Injectable()
export class NfseDanfseService {
  generateFromXml(xml: string, fallback: DanfseRenderInput): Buffer {
    const extracted = this.extractFromXml(xml);
    const merged = this.normalizeMunicipioDisplayFields(this.mergeDefined(extracted, fallback));

    return this.generatePdf({ ...merged, chaveAcesso: this.normalizeChaveAcesso(fallback.chaveAcesso) });
  }

  extractRetentionAlertData(xml: string): NfseRetentionAlertData {
    const extracted = this.extractFromXml(xml);
    const entries: NfseRetentionAlertEntry[] = [];
    const issRetido = this.describeRetencaoIss(extracted.retencaoIss, extracted.valorIssRetido) === 'Retido';

    if (issRetido) {
      entries.push({ code: 'iss', label: 'ISS retido' });
    }

    this.pushRetentionAmountEntry(entries, 'irrf', 'IRRF', extracted.valorIrrf);
    this.pushRetentionAmountEntry(entries, 'inss', 'INSS', extracted.valorContribuicaoPrevidenciaria);
    this.pushRetentionAmountEntry(entries, 'csll', 'CSLL', extracted.valorContribuicoesSociais);
    this.pushRetentionAmountEntry(entries, 'pis', 'PIS', extracted.valorPis);
    this.pushRetentionAmountEntry(entries, 'cofins', 'COFINS', extracted.valorCofins);

    return {
      hasRetention: entries.length > 0,
      entries
    };
  }

  extractLeituraFiscal(xml: string): NfseLeituraFiscal {
    const extracted = this.extractFromXml(xml);
    const retencoes = this.extractRetentionAlertData(xml).entries;
    const valorServico = this.toNumber(extracted.valorServico) ?? 0;
    const valorIss = this.toNumber(extracted.valorIss) ?? 0;
    const valorTotalRetencoes = this.toNumber(extracted.valorTotalRetencoes);
    const valorIssRetido = this.toNumber(extracted.valorIssRetido);
    const irrf = this.toNumber(extracted.valorIrrf) ?? 0;
    const inss = this.toNumber(extracted.valorContribuicaoPrevidenciaria) ?? 0;
    const csll = this.toNumber(extracted.valorContribuicoesSociais) ?? 0;
    const pis = this.toNumber(extracted.valorPis) ?? 0;
    const cofins = this.toNumber(extracted.valorCofins) ?? 0;
    const totalRetencoesFederais = irrf + inss + csll + pis + cofins;
    const retencaoIss = this.describeRetencaoIss(extracted.retencaoIss, extracted.valorIssRetido);
    const valorIssRetidoReal =
      valorIssRetido ??
      (valorTotalRetencoes !== undefined ? Math.max(valorTotalRetencoes - totalRetencoesFederais, 0) : undefined);
    const aliquotaRealIss =
      valorIssRetidoReal !== undefined && valorServico > 0 ? Number(((valorIssRetidoReal / valorServico) * 100).toFixed(2)) : undefined;

    const camposComProblema: string[] = [];
    if (valorServico === 0) {
      if ((valorIssRetidoReal ?? 0) > 0) {
        camposComProblema.push('Valor Servico', 'ISS Retido Real');
      }
      if (valorIss > 0) {
        camposComProblema.push('ISS');
      }
      if (inss > 0) {
        camposComProblema.push('INSS');
      }
      if (irrf > 0) {
        camposComProblema.push('IRRF');
      }
      if (csll > 0) {
        camposComProblema.push('CSLL');
      }
      if (pis > 0) {
        camposComProblema.push('PIS');
      }
      if (cofins > 0) {
        camposComProblema.push('COFINS');
      }
    }

    return {
      layout: this.detectLeituraFiscalLayout(xml),
      localPrestacao: this.safeValue(extracted.localPrestacao) !== '-' ? extracted.localPrestacao ?? undefined : undefined,
      localIncidenciaIss:
        this.safeValue(extracted.municipioIncidenciaIssqn) !== '-' ? extracted.municipioIncidenciaIssqn ?? undefined : undefined,
      valorServico: this.toFixedCurrencyString(valorServico),
      valorLiquidoNfse: this.toFixedCurrencyString(this.toNumber(extracted.valorLiquidoNfse)),
      valorTotalRetencoes: this.toFixedCurrencyString(valorTotalRetencoes),
      valorIss: this.toFixedCurrencyString(valorIss),
      valorIssRetido: this.toFixedCurrencyString(valorIssRetido),
      valorIssRetidoReal: this.toFixedCurrencyString(valorIssRetidoReal),
      valorIrrf: this.toFixedCurrencyString(irrf),
      valorInss: this.toFixedCurrencyString(inss),
      valorCsll: this.toFixedCurrencyString(csll),
      valorPis: this.toFixedCurrencyString(pis),
      valorCofins: this.toFixedCurrencyString(cofins),
      aliquotaIss: this.toFixedRateString(this.toNumber(extracted.aliquotaIss)),
      aliquotaRealIss: this.toFixedRateString(aliquotaRealIss),
      retencaoIss,
      retencaoFederal: totalRetencoesFederais > 0 ? 'Retido' : 'Normal',
      totalRetencoesFederais: this.toFixedCurrencyString(totalRetencoesFederais),
      statusProcessamento: camposComProblema.length > 0 ? 'Erro' : 'OK',
      erroProcessamento:
        camposComProblema.length > 0
          ? 'Divisao por zero evitada: valor do servico zerado para calculo de aliquotas e retencoes.'
          : undefined,
      camposComProblema: Array.from(new Set(camposComProblema)),
      retencoes
    };
  }

  generatePdf(input: DanfseRenderInput): Buffer {
    const normalizedInput = this.normalizeMunicipioDisplayFields({
      ...input,
      chaveAcesso: this.normalizeChaveAcesso(input.chaveAcesso)
    });
    const contentStreams = this.buildOfficialDanfseContentStreams(normalizedInput, new Date());
    return this.buildPdf(contentStreams);
  }

  private buildOfficialDanfseContentStreams(input: DanfseRenderInput, generatedAt: Date): string[] {
    const streams: string[] = [];
    const page = { width: 595, height: 842 };
    const margin = 14;
    const contentX = margin + 6;
    const contentWidth = page.width - margin * 2 - 12;
    const bottomY = margin + 18;
    const isCancelada = this.isCancelada(input.status);

    const createPage = (pageNumber: number): PdfPageState => {
      const commands: string[] = [];
      commands.push('0 G');
      commands.push('0 g');
      commands.push('0.65 w');
      commands.push(`${margin.toFixed(2)} ${margin.toFixed(2)} ${(page.width - margin * 2).toFixed(2)} ${(page.height - margin * 2).toFixed(2)} re S`);

      const state: PdfPageState = {
        commands,
        page,
        margin,
        contentX,
        contentWidth,
        bottomY,
        yTop: page.height - margin - 8,
        pageNumber
      };

      state.yTop =
        pageNumber === 1
          ? this.drawOfficialHeader(commands, input, contentX, contentWidth, state.yTop)
          : this.drawOfficialContinuationHeader(commands, input, contentX, contentWidth, state.yTop, pageNumber);

      return state;
    };

    const finalizePage = (state: PdfPageState) => {
      if (isCancelada) {
        this.drawStatusWatermark(state.commands, 'CANCELADA', state.page);
      }
      this.drawOfficialFooter(state.commands, state, generatedAt);
      streams.push(state.commands.join('\n'));
    };

    let state = createPage(1);
    const sections = this.buildOfficialSections(input);

    for (const section of sections) {
      const sectionHeight = this.measureOfficialSection(section, state.contentWidth);
      if (state.yTop - sectionHeight < state.bottomY) {
        finalizePage(state);
        state = createPage(state.pageNumber + 1);
      }

      this.drawOfficialSection(state, section);
    }

    finalizePage(state);
    return streams;
  }

  private drawOfficialHeader(
    commands: string[],
    input: DanfseRenderInput,
    contentX: number,
    contentWidth: number,
    yTop: number
  ): number {
    const hasIbsCbs = this.hasIbsCbsData(input);
    const chaveAcesso = this.normalizeChaveAcesso(input.chaveAcesso);
    const qrCodeUrl = `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chaveAcesso}`;
    const municipio = this.formatMunicipioHeader(input.municipioPrestador ?? input.municipioPrestacaoNome);
    const phone = this.safeValue(this.formatPhone(input.telefonePrestador));
    const email = this.safeValue(input.emailPrestador);
    const contact = [phone, email].filter((item) => item !== '-').join(' / ');
    const headerBottom = yTop - 122;
    const topSeparatorY = yTop - 33;
    const qrSize = 56;
    const qrX = contentX + contentWidth - qrSize - 18;
    const qrY = yTop - 88;
    const identWidth = qrX - contentX - 12;

    this.drawOfficialLogo(commands, contentX, yTop);
    this.drawText(commands, contentX + 205, yTop - 10, '/F2', 9.6, `DANFSe ${hasIbsCbs ? 'v2.0' : 'v1.0'}`);
    this.drawText(commands, contentX + 180, yTop - 22, '/F2', 8.1, 'Documento Auxiliar da NFS-e');
    this.drawText(commands, contentX + contentWidth - 142, yTop - 9, '/F2', 8.1, municipio);
    if (contact) {
      this.drawText(commands, contentX + contentWidth - 142, yTop - 19, '/F1', 5.8, contact);
    }
    if (this.isHomologacao(input.tipoAmbiente ?? input.ambiente)) {
      this.drawStatusBadge(commands, contentX + 340, yTop - 29, 96, 11, 'SEM VALIDADE JURIDICA');
    }
    if (this.isCancelada(input.status)) {
      this.drawStatusBadge(commands, contentX + 444, yTop - 29, 70, 11, 'CANCELADA');
    } else if (this.isSubstituida(input.status, input.chaveNfseSubstituida)) {
      this.drawStatusBadge(commands, contentX + 444, yTop - 29, 70, 11, 'SUBSTITUIDA');
    }

    this.drawLine(commands, contentX, topSeparatorY, contentX + contentWidth, topSeparatorY);

    this.drawText(commands, contentX, yTop - 46, '/F2', 6.9, 'Chave de Acesso da NFS-e');
    this.drawText(commands, contentX, yTop - 56, '/F1', 7.1, chaveAcesso);

    this.drawPseudoQr(commands, qrX, qrY, qrSize, qrCodeUrl);
    const authLines = [
      'A autenticidade desta NFS-e pode ser verificada',
      'pela leitura deste codigo QR ou pela consulta da',
      'chave de acesso no portal nacional da NFS-e'
    ];
    let authY = qrY - 7;
    for (const line of authLines) {
      this.drawText(commands, qrX - 56, authY, '/F1', 5.1, line);
      authY -= 6;
    }

    const cellWidth = identWidth / 3;
    const rowOneY = yTop - 78;
    const rowTwoY = yTop - 103;
    this.drawIdentificationCell(commands, 'Numero da NFS-e', this.safeValue(input.numeroNfse), contentX, rowOneY, cellWidth);
    this.drawIdentificationCell(
      commands,
      'Competencia da NFS-e',
      this.formatDateOnlyBr(input.competencia),
      contentX + cellWidth,
      rowOneY,
      cellWidth
    );
    this.drawIdentificationCell(
      commands,
      'Data e Hora da emissao da NFS-e',
      this.formatDateBr(input.dataEmissao),
      contentX + cellWidth * 2,
      rowOneY,
      cellWidth
    );
    this.drawIdentificationCell(commands, 'Numero da DPS', this.safeValue(input.numeroDps), contentX, rowTwoY, cellWidth);
    this.drawIdentificationCell(
      commands,
      'Serie da DPS',
      this.safeValue(input.serieDps ?? input.serie),
      contentX + cellWidth,
      rowTwoY,
      cellWidth
    );
    this.drawIdentificationCell(
      commands,
      'Data e Hora da emissao da DPS',
      this.formatDateBr(input.dataEmissaoDps),
      contentX + cellWidth * 2,
      rowTwoY,
      cellWidth
    );

    this.drawLine(commands, contentX, headerBottom, contentX + contentWidth, headerBottom);
    return headerBottom - 5;
  }

  private drawOfficialContinuationHeader(
    commands: string[],
    input: DanfseRenderInput,
    contentX: number,
    contentWidth: number,
    yTop: number,
    pageNumber: number
  ): number {
    const chaveAcesso = this.normalizeChaveAcesso(input.chaveAcesso);
    this.drawText(commands, contentX, yTop - 8, '/F2', 9, 'DANFSe v1.0');
    this.drawText(commands, contentX + 80, yTop - 8, '/F1', 7, 'Documento Auxiliar da NFS-e');
    this.drawText(commands, contentX + contentWidth - 48, yTop - 8, '/F2', 7, `Pagina ${pageNumber}`);
    this.drawText(commands, contentX, yTop - 21, '/F1', 6.2, `Chave de Acesso da NFS-e: ${chaveAcesso}`);
    this.drawLine(commands, contentX, yTop - 28, contentX + contentWidth, yTop - 28);
    return yTop - 34;
  }

  private buildOfficialSections(input: DanfseRenderInput): PdfSection[] {
    const field = (label: string, value?: string | number | null, span = 1): PdfField => ({
      label,
      value: this.safeValue(value),
      span
    });
    const money = (value?: string | number | null) => this.safeValue(this.formatMoney(value));
    const municipio = (value?: string | null) => this.safeValue(this.formatMunicipioUfLabel(value));
    const sectionNotice = (value: string, columns: number): PdfField => ({ value, span: columns });
    const sections: PdfSection[] = [];

    sections.push({
      title: 'EMITENTE DA NFS-E',
      columns: 4,
      fields: [
        field('CNPJ / CPF / NIF', this.formatCpfCnpj(input.cnpjPrestador)),
        field('Inscricao Municipal', input.inscricaoMunicipalPrestador),
        field('Telefone', this.formatPhone(input.telefonePrestador)),
        field('Emitente da NFS-e', this.describeEmitente(input.emitenteNfse)),
        field('Nome / Nome Empresarial', input.razaoSocialPrestador, 2),
        field('E-mail', input.emailPrestador, 2),
        field('Endereco', input.enderecoPrestador, 2),
        field('Municipio', municipio(input.municipioPrestador)),
        field('CEP', this.formatCep(input.codigoIbgeCepPrestador)),
        field('Simples Nacional na Data de Competencia', this.describeSimplesNacional(input.simplesNacional), 2),
        field('Regime de Apuracao Tributaria pelo SN', input.regimeApuracaoSn, 2)
      ]
    });

    sections.push({
      title: 'TOMADOR DO SERVICO',
      columns: 4,
      fields: this.hasIdentificacao(input.cnpjTomador, input.razaoSocialTomador, input.enderecoTomador)
        ? [
            field('CNPJ / CPF / NIF', this.formatCpfCnpj(input.cnpjTomador)),
            field('Inscricao Municipal', input.inscricaoMunicipalTomador),
            field('Telefone', this.formatPhone(input.telefoneTomador)),
            field('E-mail', input.emailTomador),
            field('Nome / Nome Empresarial', input.razaoSocialTomador, 2),
            field('Endereco', input.enderecoTomador, 2),
            field('Municipio', municipio(input.municipioTomador)),
            field('CEP', this.formatCep(input.codigoIbgeCepTomador))
          ]
        : [sectionNotice('TOMADOR DO SERVICO NAO IDENTIFICADO NA NFS-E', 4)]
    });

    sections.push({
      title: 'INTERMEDIARIO DO SERVICO',
      columns: 4,
      fields: this.hasIdentificacao(input.cnpjIntermediario, input.razaoSocialIntermediario, input.enderecoIntermediario)
        ? [
            field('CNPJ / CPF / NIF', this.formatCpfCnpj(input.cnpjIntermediario)),
            field('Inscricao Municipal', input.inscricaoMunicipalIntermediario),
            field('Telefone', this.formatPhone(input.telefoneIntermediario)),
            field('E-mail', input.emailIntermediario),
            field('Nome / Nome Empresarial', input.razaoSocialIntermediario, 2),
            field('Endereco', input.enderecoIntermediario, 2),
            field('Municipio', municipio(input.municipioIntermediario)),
            field('CEP', this.formatCep(input.codigoIbgeCepIntermediario))
          ]
        : [sectionNotice('INTERMEDIARIO DO SERVICO NAO IDENTIFICADO NA NFS-E', 4)]
    });

    if (
      this.hasIdentificacao(input.cnpjDestinatario, input.razaoSocialDestinatario, input.enderecoDestinatario) &&
      !this.isDestinatarioIgualTomador(input)
    ) {
      sections.push({
        title: 'DESTINATARIO DO SERVICO',
        columns: 4,
        fields: [
          field('CNPJ / CPF / NIF', this.formatCpfCnpj(input.cnpjDestinatario)),
          field('Telefone', this.formatPhone(input.telefoneDestinatario)),
          field('E-mail', input.emailDestinatario, 2),
          field('Nome / Nome Empresarial', input.razaoSocialDestinatario, 2),
          field('Endereco', input.enderecoDestinatario, 2),
          field('Municipio', municipio(input.municipioDestinatario)),
          field('CEP', this.formatCep(input.codigoIbgeCepDestinatario))
        ]
      });
    }

    sections.push({
      title: 'SERVICO PRESTADO',
      columns: 4,
      fields: [
        field('Codigo de Tributacao Nacional', input.codigoServicoNacional),
        field('Codigo de Tributacao Municipal', input.codigoServicoMunicipal ?? input.itemListaServico),
        field('Local da Prestacao', municipio(input.localPrestacao)),
        field('Pais da Prestacao', this.extractPais(input.localPrestacao)),
        field('Codigo da NBS', input.codigoNbs),
        field('Descricao do Codigo de Tributacao', input.descricaoCodigoTributacao, 3),
        field('Descricao do Servico', input.descricaoServico, 4)
      ]
    });

    sections.push({
      title: 'TRIBUTACAO MUNICIPAL',
      columns: 4,
      fields: this.isOperacaoNaoSujeitaIss(input.tipoTributacaoIssqn)
        ? [sectionNotice('TRIBUTACAO MUNICIPAL (ISSQN) - OPERACAO NAO SUJEITA AO ISSQN', 4)]
        : [
            field('Tributacao do ISSQN', this.describeTributacaoIssqn(input.tipoTributacaoIssqn)),
            field('Pais Resultado da Prestacao do Servico', this.extractPais(input.municipioIncidenciaIssqn)),
            field('Municipio de Incidencia do ISSQN', municipio(input.municipioIncidenciaIssqn)),
            field('Regime Especial de Tributacao', input.regimeEspecialTributacaoIssqn),
            field('Tipo de Imunidade', input.tipoImunidadeIssqn),
            field('Suspensao da Exigibilidade do ISSQN', this.describeSuspensao(input.suspensaoExigibilidadeIssqn)),
            field('Numero Processo Suspensao', input.numeroProcessoSuspensaoIssqn),
            field('Beneficio Municipal', input.beneficioMunicipal),
            field('Valor do Servico', money(input.valorServico)),
            field('Desconto Incondicionado', money(input.valorDescontoIncondicionado)),
            field('Total Deducoes/Reducoes', money(input.valorDeducoes)),
            field('Calculo do BM', input.calculoBeneficioMunicipal),
            field('BC ISSQN', money(input.baseCalculoIss)),
            field('Aliquota Aplicada', this.formatAliquota(input.aliquotaIss)),
            field('Retencao do ISSQN', this.describeRetencaoIss(input.retencaoIss, input.valorIssRetido)),
            field('ISSQN Apurado', money(input.valorIss))
          ]
    });

    sections.push({
      title: 'TRIBUTACAO FEDERAL',
      columns: 4,
      fields: [
        field('IRRF', money(input.valorIrrf)),
        field('Contribuicao Previdenciaria - Retida', money(input.valorContribuicaoPrevidenciaria)),
        field('Contribuicoes Sociais - Retidas', money(input.valorContribuicoesSociais)),
        field('Descricao Contrib. Sociais - Retidas', input.descricaoContribuicoesSociais),
        field('PIS - Debito Apuracao Propria', money(input.valorPis)),
        field('COFINS - Debito Apuracao Propria', money(input.valorCofins))
      ]
    });

    if (this.hasIbsCbsData(input)) {
      sections.push({
        title: 'TRIBUTACAO IBS/CBS',
        columns: 4,
        fields: [
          field('CST / cClassTrib', input.cstClassTribIbsCbs),
          field('Indicador de Operacao', input.indicadorOperacaoIbsCbs),
          field('Municipio de Incidencia IBS/CBS', input.municipioIncidenciaIbsCbs),
          field('Base de Calculo Apos Exclusoes e Reducoes', input.baseCalculoAposExclusoesIbsCbs),
          field('Aliquota do IBS Estadual / Municipal', input.aliquotaIbsEstadualMunicipal),
          field('Valor Total Apurado do IBS', money(input.valorTotalApuradoIbs)),
          field('Aliquota da CBS', input.aliquotaCbs),
          field('Valor Total Apurado da CBS', money(input.valorTotalApuradoCbs))
        ]
      });
    }

    sections.push({
      title: 'VALOR TOTAL DA NFS-E',
      columns: 4,
      fields: [
        field('Valor do Servico', money(input.valorServico)),
        field('Desconto Condicionado', money(input.valorDescontoCondicionado)),
        field('Desconto Incondicionado', money(input.valorDescontoIncondicionado)),
        field('ISSQN Retido', money(input.valorIssRetido)),
        field('Total das Retencoes Federais', money(this.totalRetencoesFederais(input))),
        field('PIS/COFINS - Debito Apur. Propria', money(this.sumValues(input.valorPis, input.valorCofins))),
        field('Total das Retencoes (ISSQN / Federais)', money(input.valorTotalRetencoes), 2),
        field('Valor Liquido da NFS-e', money(input.valorLiquidoNfse), 2),
        ...(this.hasIbsCbsData(input)
          ? [
              field('Total do IBS/CBS', money(input.valorTotalIbscbs)),
              field('Valor Liquido da NFS-e + IBS/CBS', money(input.valorLiquidoComIbscbs), 2)
            ]
          : [])
      ]
    });

    sections.push({
      title: 'TOTAIS APROXIMADOS DOS TRIBUTOS',
      columns: 3,
      fields: this.buildTotaisAproximadosFields(input.totaisAproximadosTributos)
    });

    sections.push({
      title: 'INFORMACOES COMPLEMENTARES',
      columns: 4,
      fields: [
        ...(this.safeValue(input.codigoNbs) !== '-' ? [field('NBS', input.codigoNbs, 4)] : []),
        field('Informacoes Complementares', this.composeOfficialInformacoesComplementares(input), 4)
      ]
    });

    return sections;
  }

  private measureOfficialSection(section: PdfSection, contentWidth: number): number {
    const rows = this.layoutOfficialSectionRows(section, contentWidth);
    return (
      10.2 +
      rows.reduce((total, row) => total + this.measureOfficialRowHeight(row), 0) +
      3.4
    );
  }

  private drawOfficialSection(state: PdfPageState, section: PdfSection): void {
    const rows = this.layoutOfficialSectionRows(section, state.contentWidth);
    const titleHeight = 10.2;
    const columnWidth = state.contentWidth / section.columns;

    this.drawLine(state.commands, state.contentX, state.yTop, state.contentX + state.contentWidth, state.yTop);
    this.drawText(state.commands, state.contentX + 1.4, state.yTop - 7.2, '/F2', 8.5, section.title);

    let rowTop = state.yTop - titleHeight;
    for (const row of rows) {
      const rowHeight = this.measureOfficialRowHeight(row);
      let colCursor = 0;

      for (const cell of row) {
        const cellX = state.contentX + colCursor * columnWidth;
        const textX = cellX + 1.8;
        let textY = rowTop - 4.9;

        if (cell.label) {
          this.drawText(state.commands, textX, textY, '/F2', 5.8, cell.label);
          textY -= 6.8;
        }

        for (const line of cell.valueLines) {
          this.drawText(state.commands, textX, textY, '/F1', 7.0, line);
          textY -= 6.8;
        }

        colCursor += cell.span;
      }

      rowTop -= rowHeight;
    }

    this.drawLine(state.commands, state.contentX, rowTop - 1.2, state.contentX + state.contentWidth, rowTop - 1.2);
    state.yTop = rowTop - 5.2;
  }

  private layoutOfficialSectionRows(
    section: PdfSection,
    contentWidth: number
  ): Array<Array<{ label?: string; valueLines: string[]; span: number }>> {
    const rows: Array<Array<{ label?: string; valueLines: string[]; span: number }>> = [];
    let current: Array<{ label?: string; valueLines: string[]; span: number }> = [];
    let used = 0;

    for (const field of section.fields) {
      const span = Math.max(1, Math.min(section.columns, field.span ?? 1));
      if (used + span > section.columns && current.length > 0) {
        rows.push(current);
        current = [];
        used = 0;
      }

      const avgCharsPerColumn = Math.max(18, Math.floor((contentWidth / section.columns) / 3.15));
      const valueLines = this.wrapText(field.value, Math.max(12, avgCharsPerColumn * span - 3));
      current.push({
        label: field.label,
        valueLines,
        span
      });
      used += span;

      if (used === section.columns) {
        rows.push(current);
        current = [];
        used = 0;
      }
    }

    if (current.length > 0) {
      rows.push(current);
    }

    return rows;
  }

  private measureOfficialRowHeight(row: Array<{ label?: string; valueLines: string[]; span: number }>): number {
    return row.reduce((maxHeight, cell) => {
      const labelHeight = cell.label ? 6.8 : 0;
      const valueHeight = Math.max(1, cell.valueLines.length) * 6.8;
      const height = 2.8 + labelHeight + valueHeight + 2.4;
      return Math.max(maxHeight, height);
    }, 12);
  }

  private drawOfficialLogo(commands: string[], x: number, yTop: number): void {
    this.drawColorText(commands, x, yTop - 20, '/F2', 22, 'NFS', 0.12, 0.55, 0.28);
    this.drawColorText(commands, x + 43, yTop - 20, '/F2', 22, 'e', 0.12, 0.36, 0.70);
    this.drawColorText(commands, x + 59, yTop - 12, '/F2', 6.1, 'Nota Fiscal de', 0.28, 0.28, 0.28);
    this.drawColorText(commands, x + 59, yTop - 20, '/F1', 5.8, 'Servico eletronica', 0.28, 0.28, 0.28);
  }

  private drawIdentificationCell(
    commands: string[],
    label: string,
    value: string,
    x: number,
    yTop: number,
    width: number
  ): void {
    this.drawText(commands, x, yTop, '/F2', 6.2, label);
    this.drawText(commands, x, yTop - 8.4, '/F1', 7.2, this.truncateForCell(value, Math.max(14, Math.floor(width / 3.15))));
  }

  private drawOfficialFooter(commands: string[], state: PdfPageState, generatedAt: Date): void {
    this.drawText(commands, state.contentX, state.margin + 5, '/F1', 5.3, `Gerado em ${this.formatDateBr(generatedAt)}`);
    this.drawText(
      commands,
      state.contentX + state.contentWidth - 48,
      state.margin + 5,
      '/F1',
      5.3,
      `Pagina ${state.pageNumber}`
    );
  }

  private drawStatusBadge(
    commands: string[],
    x: number,
    y: number,
    width: number,
    height: number,
    text: string
  ): void {
    commands.push('1.00 0.93 0.93 rg');
    commands.push('0.82 0.10 0.10 RG');
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re B`);
    commands.push('0 0 0 rg');
    commands.push('0 0 0 RG');
    this.drawColorText(commands, x + 4, y + 3.2, '/F2', 5.8, text, 0.70, 0.02, 0.02);
  }

  private drawStatusWatermark(commands: string[], text: string, page: { width: number; height: number }): void {
    commands.push('q');
    commands.push('0.87 g');
    commands.push('BT');
    commands.push('/F2 66 Tf');
    commands.push(`0.7071 0.7071 -0.7071 0.7071 ${(page.width / 2 - 190).toFixed(2)} ${(page.height / 2 - 235).toFixed(2)} Tm`);
    commands.push(`(${this.escapePdfText(text)}) Tj`);
    commands.push('ET');
    commands.push('0 g');
    commands.push('Q');
  }

  private drawColorText(
    commands: string[],
    x: number,
    y: number,
    font: PdfFont,
    size: number,
    text: string,
    r: number,
    g: number,
    b: number
  ): void {
    commands.push(`${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg`);
    this.drawText(commands, x, y, font, size, text);
    commands.push('0 0 0 rg');
  }

  private buildTotaisAproximadosFields(value?: string | null): PdfField[] {
    return [
      { label: 'Federais', value: this.extractTotalAproximado(value, 'Federais') },
      { label: 'Estaduais', value: this.extractTotalAproximado(value, 'Estaduais') },
      { label: 'Municipais', value: this.extractTotalAproximado(value, 'Municipais') }
    ];
  }

  private extractTotalAproximado(value: string | null | undefined, label: string): string {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return '-';
    }

    const match = normalized.match(new RegExp(`${label}:\\s*([^;|]+)`, 'i'));
    if (!match?.[1]) {
      return '-';
    }

    return this.formatPercentSpacing(match[1].trim());
  }

  private composeOfficialInformacoesComplementares(input: DanfseRenderInput): string {
    const chunks: string[] = [];
    const push = (label: string, value?: string | null) => {
      const normalized = this.safeValue(value);
      if (normalized !== '-') {
        chunks.push(`${label}: ${normalized}`);
      }
    };

    push('Inf. Cont.', input.infoComplementares);
    push('NFS-e Subst.', input.chaveNfseSubstituida);
    push('Doc. Ref.', input.documentoReferencia);
    push('Cod. Obra', input.codigoObra);
    push('Insc. Imob.', input.inscricaoImobiliaria);
    push('Cod. Evt.', input.codigoEvento);
    push('Doc. Tec.', input.documentoTecnico);
    push('Num. Ped.', input.numeroPedido);
    push('Item Ped.', input.itemPedido);
    push('Inf. A. T. Mun.', input.infoAdministracaoMunicipal);
    push('Codigo de Verificacao', input.codigoVerificacao);
    push('Ambiente Gerador', input.ambienteGerador);

    return chunks.join(' | ') || '-';
  }

  private formatMunicipioHeader(value?: string | null): string {
    const municipio = this.safeValue(this.formatMunicipioUfLabel(value));
    if (municipio === '-') {
      return 'MUNICIPIO';
    }

    const city = municipio.split(/\s+-\s+/)[0]?.trim() || municipio;
    return this.normalizePrintable(`MUNICIPIO DE ${city}`).toUpperCase();
  }

  private truncateForCell(value: string, maxLen: number): string {
    const normalized = this.safeValue(value);
    if (normalized.length <= maxLen) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(1, maxLen - 1))}.`;
  }

  private formatPercentSpacing(value: string): string {
    return this.safeValue(value).replace(/\s*%/g, ' %');
  }

  private buildDanfseLines(input: DanfseRenderInput, generatedAt: Date): string[] {
    const lines: string[] = [];
    const pushSection = (title: string) => {
      if (lines.length > 0) {
        lines.push('');
      }
      lines.push(title);
    };
    const pushField = (label: string, value: string) => {
      lines.push(`${label}: ${value}`);
    };
    const pushWrappedField = (label: string, value: string, width = 120) => {
      const wrapped = this.wrapText(value, width);
      if (!wrapped.length) {
        lines.push(`${label}: -`);
        return;
      }
      lines.push(`${label}: ${wrapped[0]}`);
      for (let i = 1; i < wrapped.length; i += 1) {
        lines.push(`  ${wrapped[i]}`);
      }
    };

    const chaveAcesso = this.normalizeChaveAcesso(input.chaveAcesso);
    const tipoAmbiente = this.safeValue(input.tipoAmbiente ?? input.ambiente);
    const isHomologacao = this.isHomologacao(tipoAmbiente);
    const isCancelada = this.isCancelada(input.status);
    const isSubstituida = this.isSubstituida(input.status, input.chaveNfseSubstituida);
    const hasIbsCbs = this.hasIbsCbsData(input);
    const qrCodeUrl = `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chaveAcesso}`;
    const infosComplementares = this.composeInformacoesComplementares(input);

    const municipioCabecalho = this.safeValue(this.formatMunicipioUfLabel(input.municipioPrestador));
    const telefoneCabecalho = this.safeValue(this.formatPhone(input.telefonePrestador));
    const emailCabecalho = this.safeValue(input.emailPrestador);

    lines.push(`DANFSe ${hasIbsCbs ? 'v2.0' : 'v1.0'}`);
    lines.push('Documento Auxiliar da NFS-e');
    if (isHomologacao) {
      lines.push('NFS-e SEM VALIDADE JURIDICA');
    }
    if (municipioCabecalho !== '-') {
      lines.push(`MUNICIPIO ${municipioCabecalho}`);
    }
    if (telefoneCabecalho !== '-' || emailCabecalho !== '-') {
      lines.push(`${telefoneCabecalho} ${emailCabecalho}`.trim());
    }
    if (isCancelada) {
      lines.push('*** CANCELADA ***');
    } else if (isSubstituida) {
      lines.push('*** SUBSTITUIDA ***');
    }

    pushSection('DADOS DE IDENTIFICACAO DA NFS-E');
    pushField('Chave de Acesso da NFS-e', chaveAcesso);
    pushField('Numero da NFS-e', this.safeValue(input.numeroNfse));
    pushField('Competencia da NFS-e', this.formatDateOnlyBr(input.competencia));
    pushField('Data e Hora da emissao da NFS-e', this.formatDateBr(input.dataEmissao));
    pushField('Numero da DPS', this.safeValue(input.numeroDps));
    pushField('Serie da DPS', this.safeValue(input.serieDps ?? input.serie));
    pushField('Data e Hora da emissao da DPS', this.formatDateBr(input.dataEmissaoDps));
    pushField('Situacao da NFS-e', this.safeValue(input.status));
    pushField('Emitente da NFS-e', this.describeEmitente(input.emitenteNfse));
    pushField('Finalidade', this.safeValue(input.finalidade));
    pushField('Ambiente Gerador', this.safeValue(input.ambienteGerador));
    pushField('Tipo de Ambiente', tipoAmbiente);
    pushField('Codigo de Verificacao', this.safeValue(input.codigoVerificacao));

    lines.push('');
    lines.push('A autenticidade desta NFS-e pode ser verificada');
    lines.push('pela leitura deste codigo QR ou pela consulta da');
    lines.push('chave de acesso no portal nacional da NFS-e');
    pushField('Consulta Publica', qrCodeUrl);

    pushSection('EMITENTE DA NFS-E');
    lines.push(this.describeEmitente(input.emitenteNfse));
    pushField('CNPJ / CPF / NIF', this.safeValue(this.formatCpfCnpj(input.cnpjPrestador)));
    pushField('Inscricao Municipal', this.safeValue(input.inscricaoMunicipalPrestador));
    pushField('Telefone', this.safeValue(this.formatPhone(input.telefonePrestador)));
    pushWrappedField('Nome / Nome Empresarial', this.safeValue(input.razaoSocialPrestador), 120);
    pushField('E-mail', this.safeValue(input.emailPrestador));
    pushWrappedField('Endereco', this.safeValue(input.enderecoPrestador), 120);
    pushField('Municipio', this.safeValue(this.formatMunicipioUfLabel(input.municipioPrestador)));
    pushField('CEP', this.safeValue(this.formatCep(input.codigoIbgeCepPrestador)));
    pushField('Simples Nacional na Data de Competencia', this.safeValue(this.describeSimplesNacional(input.simplesNacional)));
    pushWrappedField('Regime de Apuracao Tributaria pelo SN', this.safeValue(input.regimeApuracaoSn), 120);

    pushSection('TOMADOR DO SERVICO');
    if (this.hasIdentificacao(input.cnpjTomador, input.razaoSocialTomador, input.enderecoTomador)) {
      pushField('CNPJ / CPF / NIF', this.safeValue(this.formatCpfCnpj(input.cnpjTomador)));
      pushField('Inscricao Municipal', this.safeValue(input.inscricaoMunicipalTomador));
      pushField('Telefone', this.safeValue(this.formatPhone(input.telefoneTomador)));
      pushWrappedField('Nome / Nome Empresarial', this.safeValue(input.razaoSocialTomador), 120);
      pushField('E-mail', this.safeValue(input.emailTomador));
      pushWrappedField('Endereco', this.safeValue(input.enderecoTomador), 120);
      pushField('Municipio', this.safeValue(this.formatMunicipioUfLabel(input.municipioTomador)));
      pushField('CEP', this.safeValue(this.formatCep(input.codigoIbgeCepTomador)));
    } else {
      lines.push('TOMADOR DO SERVICO NAO IDENTIFICADO NA NFS-E');
    }

    pushSection('INTERMEDIARIO DO SERVICO');
    if (this.hasIdentificacao(input.cnpjIntermediario, input.razaoSocialIntermediario, input.enderecoIntermediario)) {
      pushField('CNPJ / CPF / NIF', this.safeValue(this.formatCpfCnpj(input.cnpjIntermediario)));
      pushField('Inscricao Municipal', this.safeValue(input.inscricaoMunicipalIntermediario));
      pushField('Telefone', this.safeValue(this.formatPhone(input.telefoneIntermediario)));
      pushWrappedField('Nome / Nome Empresarial', this.safeValue(input.razaoSocialIntermediario), 120);
      pushField('E-mail', this.safeValue(input.emailIntermediario));
      pushWrappedField('Endereco', this.safeValue(input.enderecoIntermediario), 120);
      pushField('Municipio', this.safeValue(this.formatMunicipioUfLabel(input.municipioIntermediario)));
      pushField('CEP', this.safeValue(this.formatCep(input.codigoIbgeCepIntermediario)));
    } else {
      lines.push('INTERMEDIARIO DO SERVICO NAO IDENTIFICADO NA NFS-E');
    }

    if (this.hasIdentificacao(input.cnpjDestinatario, input.razaoSocialDestinatario, input.enderecoDestinatario)) {
      pushSection('DESTINATARIO DO SERVICO');
      pushField('CNPJ / CPF / NIF', this.safeValue(this.formatCpfCnpj(input.cnpjDestinatario)));
      pushField('Telefone', this.safeValue(this.formatPhone(input.telefoneDestinatario)));
      pushWrappedField('Nome / Nome Empresarial', this.safeValue(input.razaoSocialDestinatario), 120);
      pushField('E-mail', this.safeValue(input.emailDestinatario));
      pushWrappedField('Endereco', this.safeValue(input.enderecoDestinatario), 120);
      pushField('Municipio', this.safeValue(this.formatMunicipioUfLabel(input.municipioDestinatario)));
      pushField('CEP', this.safeValue(this.formatCep(input.codigoIbgeCepDestinatario)));
    }

    pushSection('SERVICO PRESTADO');
    pushField('Codigo de Tributacao Nacional', this.safeValue(input.codigoServicoNacional));
    pushField('Codigo de Tributacao Municipal', this.safeValue(input.codigoServicoMunicipal ?? input.itemListaServico));
    pushField('Codigo da NBS', this.safeValue(input.codigoNbs));
    pushField('Local da Prestacao', this.safeValue(this.formatMunicipioUfLabel(input.localPrestacao)));
    pushField('Pais da Prestacao', this.safeValue(this.extractPais(input.localPrestacao)));
    pushWrappedField('Descricao do Codigo de Tributacao', this.safeValue(input.descricaoCodigoTributacao), 140);
    pushWrappedField('Descricao do Servico', this.safeValue(input.descricaoServico), 140);

    pushSection('TRIBUTACAO MUNICIPAL');
    if (this.isOperacaoNaoSujeitaIss(input.tipoTributacaoIssqn)) {
      lines.push('TRIBUTACAO MUNICIPAL (ISSQN) - OPERACAO NAO SUJEITA AO ISSQN');
    } else {
      pushField('Tributacao do ISSQN', this.safeValue(this.describeTributacaoIssqn(input.tipoTributacaoIssqn)));
      pushField('Pais Resultado da Prestacao do Servico', this.safeValue(this.extractPais(input.municipioIncidenciaIssqn)));
      pushField('Municipio de Incidencia do ISSQN', this.safeValue(this.formatMunicipioUfLabel(input.municipioIncidenciaIssqn)));
      pushField('Regime Especial de Tributacao', this.safeValue(input.regimeEspecialTributacaoIssqn));
      pushField('Tipo de Imunidade', this.safeValue(input.tipoImunidadeIssqn));
      pushField('Suspensao da Exigibilidade do ISSQN', this.safeValue(this.describeSuspensao(input.suspensaoExigibilidadeIssqn)));
      pushField('Numero Processo Suspensao', this.safeValue(input.numeroProcessoSuspensaoIssqn));
      pushField('Beneficio Municipal', this.safeValue(input.beneficioMunicipal));
      pushField('Valor do Servico', this.safeValue(this.formatMoney(input.valorServico)));
      pushField('Desconto Incondicionado', this.safeValue(this.formatMoney(input.valorDescontoIncondicionado)));
      pushField('Total Deducoes/Reducoes', this.safeValue(this.formatMoney(input.valorDeducoes)));
      pushField('Calculo do BM', this.safeValue(input.calculoBeneficioMunicipal));
      pushField('BC ISSQN', this.safeValue(this.formatMoney(input.baseCalculoIss)));
      pushField('Aliquota Aplicada', this.safeValue(this.formatAliquota(input.aliquotaIss)));
      pushField('Retencao do ISSQN', this.safeValue(this.describeRetencaoIss(input.retencaoIss, input.valorIssRetido)));
      pushField('ISSQN Apurado', this.safeValue(this.formatMoney(input.valorIss)));
    }

    pushSection('TRIBUTACAO FEDERAL');
    pushField('IRRF', this.safeValue(this.formatMoney(input.valorIrrf)));
    pushField(
      'Contribuicao Previdenciaria - Retida',
      this.safeValue(this.formatMoney(input.valorContribuicaoPrevidenciaria))
    );
    pushField('Contribuicoes Sociais - Retidas', this.safeValue(this.formatMoney(input.valorContribuicoesSociais)));
    pushWrappedField(
      'Descricao Contrib. Sociais - Retidas',
      this.safeValue(input.descricaoContribuicoesSociais),
      120
    );
    pushField('PIS - Debito Apuracao Propria', this.safeValue(this.formatMoney(input.valorPis)));
    pushField('COFINS - Debito Apuracao Propria', this.safeValue(this.formatMoney(input.valorCofins)));

    if (hasIbsCbs) {
      pushSection('TRIBUTACAO IBS/CBS');
      pushField('CST / cClassTrib', this.safeValue(input.cstClassTribIbsCbs));
      pushField('Indicador de Operacao', this.safeValue(input.indicadorOperacaoIbsCbs));
      pushField('Municipio de Incidencia IBS/CBS', this.safeValue(input.municipioIncidenciaIbsCbs));
      pushField('Exclusoes e Reducoes da Base de Calculo', this.safeValue(input.exclusoesReducoesBcIbsCbs));
      pushField('Base de Calculo Apos Exclusoes e Reducoes', this.safeValue(input.baseCalculoAposExclusoesIbsCbs));
      pushField('Reducao da Aliquota do IBS', this.safeValue(input.reducaoAliquotaIbs));
      pushField('Reducao da Aliquota da CBS', this.safeValue(input.reducaoAliquotaCbs));
      pushField('Aliquota do IBS Estadual / Municipal', this.safeValue(input.aliquotaIbsEstadualMunicipal));
      pushField('Aliquota Efetiva do IBS Municipal', this.safeValue(input.aliquotaEfetivaIbsMunicipal));
      pushField('Valor Apurado do IBS Municipal', this.safeValue(this.formatMoney(input.valorApuradoIbsMunicipal)));
      pushField('Aliquota Efetiva do IBS Estadual', this.safeValue(input.aliquotaEfetivaIbsEstadual));
      pushField('Valor Apurado do IBS Estadual', this.safeValue(this.formatMoney(input.valorApuradoIbsEstadual)));
      pushField('Valor Total Apurado do IBS', this.safeValue(this.formatMoney(input.valorTotalApuradoIbs)));
      pushField('Aliquota da CBS', this.safeValue(input.aliquotaCbs));
      pushField('Aliquota Efetiva da CBS', this.safeValue(input.aliquotaEfetivaCbs));
      pushField('Valor Total Apurado da CBS', this.safeValue(this.formatMoney(input.valorTotalApuradoCbs)));
    }

    pushSection('VALOR TOTAL DA NFS-E');
    pushField('Valor do Servico', this.safeValue(this.formatMoney(input.valorServico)));
    pushField('Desconto Condicionado', this.safeValue(this.formatMoney(input.valorDescontoCondicionado)));
    pushField('Desconto Incondicionado', this.safeValue(this.formatMoney(input.valorDescontoIncondicionado)));
    pushField('ISSQN Retido', this.safeValue(this.formatMoney(input.valorIssRetido)));
    pushField('Total das Retencoes Federais', this.safeValue(this.formatMoney(this.totalRetencoesFederais(input))));
    pushField('PIS/COFINS - Debito Apur. Propria', this.safeValue(this.formatMoney(this.sumValues(input.valorPis, input.valorCofins))));
    pushField('Total das Retencoes (ISSQN / Federais)', this.safeValue(this.formatMoney(input.valorTotalRetencoes)));
    pushField('Valor Liquido da NFS-e', this.safeValue(this.formatMoney(input.valorLiquidoNfse)));
    if (hasIbsCbs) {
      pushField('Total do IBS/CBS', this.safeValue(this.formatMoney(input.valorTotalIbscbs)));
      pushField('Valor Liquido da NFS-e + IBS/CBS', this.safeValue(this.formatMoney(input.valorLiquidoComIbscbs)));
    }

    pushSection('TOTAIS APROXIMADOS DOS TRIBUTOS');
    pushWrappedField('Lei n 12.741/2012', this.safeValue(input.totaisAproximadosTributos), 140);

    pushSection('INFORMACOES COMPLEMENTARES');
    pushWrappedField('Informacoes Complementares', infosComplementares, 140);

    lines.push('');
    lines.push(`Gerado em: ${this.formatDateBr(generatedAt)}`);

    return lines;
  }

  private extractFromXml(xml: string): Omit<DanfseRenderInput, 'chaveAcesso'> {
    const competenciaRaw =
      this.extractFromPaths(xml, [
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Competencia'],
        ['InfDeclaracaoPrestacaoServico', 'Competencia']
      ]) ?? this.extract(xml, ['competencia', 'dCompet']);
    const dataEmissao = this.parseDate(this.extract(xml, ['dataEmissao', 'DataEmissao', 'dhProc']));
    const dataEmissaoDps = this.parseDate(this.extractFromPaths(xml, [['infDPS', 'dhEmi'], ['DPS', 'infDPS', 'dhEmi']]));
    const competencia = this.parseDateOnly(competenciaRaw);
    const dataCancelamento = this.parseDate(
      this.extractFromPaths(xml, [
        ['NfseCancelamento', 'Confirmacao', 'Pedido', 'InfPedidoCancelamento', 'DataHora'],
        ['NfseCancelamento', 'Pedido', 'InfPedidoCancelamento', 'DataHora'],
        ['InfPedidoCancelamento', 'DataHora']
      ])
    );
    const status =
      dataCancelamento !== undefined
        ? 'Cancelada'
        : this.extract(xml, ['status', 'Situacao', 'cStat']);

    const cnpjPrestador =
      this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'CNPJ'],
        ['emit', 'CNPJ'],
        ['prestador', 'CNPJ'],
        ['PrestadorServico', 'IdentificacaoPrestador', 'CpfCnpj', 'Cnpj'],
        ['PrestadorServico', 'IdentificacaoPrestador', 'CpfCnpj', 'CPF']
      ]) ?? this.extract(xml, ['CnpjPrestador']);

    const cnpjTomador =
      this.extractFromPaths(xml, [
        ['infDPS', 'toma', 'CNPJ'],
        ['infDPS', 'toma', 'CPF'],
        ['tomador', 'CNPJ'],
        ['Tomador', 'IdentificacaoTomador', 'CpfCnpj', 'Cnpj'],
        ['Tomador', 'IdentificacaoTomador', 'CpfCnpj', 'CPF'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'IdentificacaoTomador', 'CpfCnpj', 'Cnpj'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'IdentificacaoTomador', 'CpfCnpj', 'CPF']
      ]) ?? this.extract(xml, ['CnpjTomador']);

    const cnpjDestinatario = this.extractFromPaths(xml, [
      ['infDPS', 'IBSCBS', 'dest', 'CNPJ'],
      ['infDPS', 'IBSCBS', 'dest', 'CPF']
    ]);

    const cnpjIntermediario = this.extractFromPaths(xml, [
      ['infDPS', 'interm', 'CNPJ'],
      ['infDPS', 'interm', 'CPF']
    ]);

    const municipioPrestacaoCodigo =
      this.extractFromPaths(xml, [
        ['infDPS', 'serv', 'locPrest', 'cLocPrestacao'],
        ['serv', 'locPrest', 'cLocPrestacao'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'MunicipioIncidencia'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'CodigoMunicipio']
      ]) ?? this.extract(xml, ['municipioPrestacaoCodigo', 'codigoMunicipioPrestacao', 'cLocPrestacao']);

    const municipioPrestacaoNome = this.extract(xml, ['municipioPrestacaoNome', 'xLocPrestacao']);
    const codigoServicoNacional = this.extractFromPaths(xml, [
      ['infDPS', 'serv', 'cServ', 'cTribNac'],
      ['serv', 'cServ', 'cTribNac']
    ]);
    const codigoServicoMunicipal = this.extractFromPaths(xml, [
      ['infDPS', 'serv', 'cServ', 'cTribMun'],
      ['serv', 'cServ', 'cTribMun']
    ]);
    const descricaoCodigoTributacao =
      this.extractFromPaths(xml, [
        ['infDPS', 'serv', 'cServ', 'xTribMun'],
        ['infDPS', 'serv', 'cServ', 'xTribNac'],
        ['serv', 'cServ', 'xTribMun'],
        ['serv', 'cServ', 'xTribNac']
      ]) ?? this.extract(xml, ['xTribMun', 'xTribNac']);
    const descricaoServico =
      this.extractFromPaths(xml, [
        ['infDPS', 'serv', 'cServ', 'xDescServ'],
        ['serv', 'cServ', 'xDescServ']
      ]) ?? this.extract(xml, ['descricaoServico', 'Discriminacao', 'xDescServ']);

    const valorServico =
      this.extractFromPaths(xml, [
        ['infDPS', 'valores', 'vServPrest', 'vServ'],
        ['valores', 'vServPrest', 'vServ'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorServicos']
      ]) ??
      this.extract(xml, ['valorServico', 'ValorServicos', 'vServ']);

    const valorDeducoes = this.extract(xml, ['valorDeducoes', 'vDeducao']);
    const valorDescontoIncondicionado = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'vDescCondIncond', 'vDescIncond'],
      ['valores', 'vDescCondIncond', 'vDescIncond']
    ]);
    const valorDescontoCondicionado = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'vDescCondIncond', 'vDescCond'],
      ['valores', 'vDescCondIncond', 'vDescCond']
    ]);

    const valorIrrf = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'trib', 'tribFed', 'vRetIRRF'],
      ['valores', 'trib', 'tribFed', 'vRetIRRF'],
      ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorIr'],
      ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorIr']
    ]);
    const valorContribuicaoPrevidenciaria = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'trib', 'tribFed', 'vRetCP'],
      ['valores', 'trib', 'tribFed', 'vRetCP'],
      ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorInss'],
      ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorInss']
    ]);
    const valorContribuicoesSociais = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'trib', 'tribFed', 'vRetCSLL'],
      ['valores', 'trib', 'tribFed', 'vRetCSLL'],
      ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorCsll'],
      ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorCsll']
    ]);
    const valorPis = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'trib', 'tribFed', 'piscofins', 'vPis'],
      ['valores', 'trib', 'tribFed', 'piscofins', 'vPis'],
      ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorPis'],
      ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorPis']
    ]);
    const valorCofins = this.extractFromPaths(xml, [
      ['infDPS', 'valores', 'trib', 'tribFed', 'piscofins', 'vCofins'],
      ['valores', 'trib', 'tribFed', 'piscofins', 'vCofins'],
      ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorCofins'],
      ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorCofins']
    ]);

    const vIbsTot = this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'totCIBS', 'gIBS', 'vIBSTot']]);
    const vCbs = this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'totCIBS', 'gCBS', 'vCBS']]);
    const valorTotalIbscbs = this.sumValues(vIbsTot, vCbs);

    return {
      ambienteGerador: this.extractFromPaths(xml, [['infNFSe', 'ambGer']]),
      tipoAmbiente: this.extractFromPaths(xml, [['infDPS', 'tpAmb'], ['DPS', 'infDPS', 'tpAmb']]),
      numeroNfse: this.extract(xml, ['numeroNFSe', 'numeroNfse', 'Numero', 'nNFSe']),
      numeroDps: this.extractFromPaths(xml, [['infDPS', 'nDPS'], ['DPS', 'infDPS', 'nDPS']]),
      serie: this.extract(xml, ['serie']),
      serieDps: this.extractFromPaths(xml, [['infDPS', 'serie'], ['DPS', 'infDPS', 'serie']]),
      dataEmissao,
      dataEmissaoDps,
      competencia,
      status,
      emitenteNfse: this.extractFromPaths(xml, [['infDPS', 'tpEmit'], ['DPS', 'infDPS', 'tpEmit']]),
      finalidade: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'finNFSe']]),
      codigoVerificacao: this.extract(xml, ['codigoVerificacao', 'cVerif', 'codigoVerificacaoNfse']),
      cnpjPrestador,
      razaoSocialPrestador: this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'xNome'],
        ['emit', 'xNome'],
        ['prestador', 'xNome'],
        ['PrestadorServico', 'RazaoSocial'],
        ['PrestadorServico', 'NomeFantasia']
      ]),
      inscricaoMunicipalPrestador: this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'IM'],
        ['PrestadorServico', 'IdentificacaoPrestador', 'InscricaoMunicipal']
      ]),
      telefonePrestador: this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'fone'],
        ['emit', 'fone'],
        ['PrestadorServico', 'Contato', 'Telefone']
      ]),
      enderecoPrestador: this.composeAddress(xml, [
        ['infDPS', 'prest', 'end'],
        ['emit', 'enderNac'],
        ['PrestadorServico', 'Endereco']
      ]),
      municipioPrestador: this.composeMunicipioUf(
        this.extractFromPaths(xml, [
          ['infDPS', 'prest', 'end', 'endNac', 'cMun'],
          ['emit', 'enderNac', 'cMun'],
          ['PrestadorServico', 'Endereco', 'CodigoMunicipio']
        ]),
        this.extractFromPaths(xml, [
          ['infDPS', 'prest', 'end', 'endNac', 'UF'],
          ['emit', 'enderNac', 'UF'],
          ['PrestadorServico', 'Endereco', 'Uf']
        ]),
        this.extractFromPaths(xml, [
          ['infNFSe', 'xLocEmi'],
          ['infDPS', 'prest', 'end', 'endNac', 'xMun'],
          ['emit', 'enderNac', 'xMun'],
          ['PrestadorServico', 'Endereco', 'Cidade']
        ])
      ) ??
        this.composeMunicipioUf(
          this.extractFromParentPaths(xml, [['PrestadorServico']], ['CodigoMunicipio']),
          this.extractFromParentPaths(xml, [['PrestadorServico']], ['Uf']),
          this.extractFromParentPaths(xml, [['PrestadorServico']], ['Cidade'])
        ),
      codigoIbgeCepPrestador: this.composeIbgeCep(
        this.extractFromPaths(xml, [
          ['infDPS', 'prest', 'end', 'endNac', 'cMun'],
          ['emit', 'enderNac', 'cMun'],
          ['PrestadorServico', 'Endereco', 'CodigoMunicipio']
        ]),
        this.extractFromPaths(xml, [
          ['infDPS', 'prest', 'end', 'endNac', 'CEP'],
          ['emit', 'enderNac', 'CEP'],
          ['PrestadorServico', 'Endereco', 'Cep']
        ])
      ) ??
        this.composeIbgeCep(
          this.extractFromParentPaths(xml, [['PrestadorServico']], ['CodigoMunicipio']),
          this.extractFromParentPaths(xml, [['PrestadorServico']], ['Cep'])
        ),
      emailPrestador: this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'email'],
        ['emit', 'email'],
        ['PrestadorServico', 'Contato', 'Email']
      ]),
      simplesNacional: this.extractFromPaths(xml, [
        ['infDPS', 'prest', 'regTrib', 'opSimpNac'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'OptanteSimplesNacional']
      ]),
      regimeApuracaoSn: this.extractFromPaths(xml, [['infDPS', 'prest', 'regTrib', 'regApTribSN']]),
      cnpjTomador,
      razaoSocialTomador: this.extractFromPaths(xml, [
        ['infDPS', 'toma', 'xNome'],
        ['tomador', 'xNome'],
        ['Tomador', 'RazaoSocial'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'RazaoSocial']
      ]),
      inscricaoMunicipalTomador: this.extractFromPaths(xml, [['infDPS', 'toma', 'IM']]),
      telefoneTomador: this.extractFromPaths(xml, [['infDPS', 'toma', 'fone']]),
      enderecoTomador: this.composeAddress(xml, [
        ['infDPS', 'toma', 'end'],
        ['Tomador', 'Endereco'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco']
      ]),
      municipioTomador: this.composeMunicipioUf(
        this.extractFromPaths(xml, [
          ['infDPS', 'toma', 'end', 'endNac', 'cMun'],
          ['Tomador', 'Endereco', 'CodigoMunicipio'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'CodigoMunicipio']
        ]),
        this.extractFromPaths(xml, [
          ['infDPS', 'toma', 'end', 'endNac', 'UF'],
          ['Tomador', 'Endereco', 'Uf'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Uf']
        ]),
        this.extractFromPaths(xml, [
          ['infDPS', 'toma', 'end', 'endNac', 'xMun'],
          ['Tomador', 'Endereco', 'Cidade'],
          ['Tomador', 'Endereco', 'xMun'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Cidade'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'xMun']
        ])
      ) ??
        this.composeMunicipioUf(
          this.extractFromParentPaths(
            xml,
            [['Tomador'], ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador']],
            ['CodigoMunicipio']
          ),
          this.extractFromParentPaths(
            xml,
            [['Tomador'], ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador']],
            ['Uf']
          ),
          this.extractFromParentPaths(
            xml,
            [['Tomador'], ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador']],
            ['Cidade']
          )
        ),
      codigoIbgeCepTomador: this.composeIbgeCep(
        this.extractFromPaths(xml, [
          ['infDPS', 'toma', 'end', 'endNac', 'cMun'],
          ['Tomador', 'Endereco', 'CodigoMunicipio'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'CodigoMunicipio']
        ]),
        this.extractFromPaths(xml, [
          ['infDPS', 'toma', 'end', 'endNac', 'CEP'],
          ['Tomador', 'Endereco', 'Cep'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Cep']
        ])
      ) ??
        this.composeIbgeCep(
          this.extractFromParentPaths(
            xml,
            [['Tomador'], ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador']],
            ['CodigoMunicipio']
          ),
          this.extractFromParentPaths(
            xml,
            [['Tomador'], ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador']],
            ['Cep']
          )
        ),
      emailTomador: this.extractFromPaths(xml, [['infDPS', 'toma', 'email']]),
      cnpjDestinatario,
      razaoSocialDestinatario: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'xNome']]),
      telefoneDestinatario: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'fone']]),
      enderecoDestinatario: this.composeAddress(xml, [['infDPS', 'IBSCBS', 'dest', 'end']]),
      municipioDestinatario: this.composeMunicipioUf(
        this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'end', 'endNac', 'cMun']]),
        this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'end', 'endNac', 'UF']])
      ),
      codigoIbgeCepDestinatario: this.composeIbgeCep(
        this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'end', 'endNac', 'cMun']]),
        this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'end', 'endNac', 'CEP']])
      ),
      emailDestinatario: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'dest', 'email']]),
      cnpjIntermediario,
      razaoSocialIntermediario: this.extractFromPaths(xml, [['infDPS', 'interm', 'xNome']]),
      inscricaoMunicipalIntermediario: this.extractFromPaths(xml, [['infDPS', 'interm', 'IM']]),
      telefoneIntermediario: this.extractFromPaths(xml, [['infDPS', 'interm', 'fone']]),
      enderecoIntermediario: this.composeAddress(xml, [['infDPS', 'interm', 'end']]),
      municipioIntermediario: this.composeMunicipioUf(
        this.extractFromPaths(xml, [['infDPS', 'interm', 'end', 'endNac', 'cMun']]),
        this.extractFromPaths(xml, [['infDPS', 'interm', 'end', 'endNac', 'UF']])
      ),
      codigoIbgeCepIntermediario: this.composeIbgeCep(
        this.extractFromPaths(xml, [['infDPS', 'interm', 'end', 'endNac', 'cMun']]),
        this.extractFromPaths(xml, [['infDPS', 'interm', 'end', 'endNac', 'CEP']])
      ),
      emailIntermediario: this.extractFromPaths(xml, [['infDPS', 'interm', 'email']]),
      municipioPrestacaoCodigo,
      municipioPrestacaoNome,
      localPrestacao: this.composeLocalPrestacao(
        this.extractFromPaths(xml, [
          ['infDPS', 'serv', 'locPrest', 'xLocPrestacao'],
          ['infNFSe', 'xLocPrestacao'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'MunicipioIncidencia'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'CodigoMunicipio']
        ]),
        this.extractFromPaths(xml, [['infDPS', 'serv', 'locPrest', 'UF']]),
        this.extractFromPaths(xml, [['infDPS', 'serv', 'locPrest', 'cPaisPrestacao']])
      ),
      valorServico,
      valorDeducoes,
      valorDescontoIncondicionado,
      valorDescontoCondicionado,
      valorTotalRetencoes: this.extractFromPaths(xml, [
        ['infNFSe', 'valores', 'vTotalRet'],
        ['valores', 'vTotalRet'],
        ['InfNfse', 'ValoresNfse', 'ValorTotalRetencoes']
      ]),
      valorLiquidoNfse: this.extractFromPaths(xml, [
        ['infNFSe', 'valores', 'vLiq'],
        ['valores', 'vLiq'],
        ['InfNfse', 'ValoresNfse', 'ValorLiquidoNfse']
      ]),
      valorTotalIbscbs,
      valorLiquidoComIbscbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'totCIBS', 'vTotNF']]),
      valorIss: this.extract(xml, ['valorIss', 'valorISS', 'ValorIss', 'vISSQN', 'vISS']),
      valorIssRetido: this.extractFromPaths(xml, [
        ['infNFSe', 'valores', 'vISSRet'],
        ['valores', 'vISSRet'],
        ['InfNfse', 'ValoresNfse', 'ValorIssRetido'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorIssRetido'],
        ['InfDeclaracaoPrestacaoServico', 'Servico', 'Valores', 'ValorIssRetido']
      ]),
      baseCalculoIss: this.extractFromPaths(xml, [
        ['infNFSe', 'valores', 'vBC'],
        ['valores', 'vBC'],
        ['infDPS', 'valores', 'trib', 'tribMun', 'vBCISSQN'],
        ['InfNfse', 'ValoresNfse', 'BaseCalculo']
      ]),
      retencaoIss: this.extractFromPaths(xml, [
        ['infDPS', 'valores', 'trib', 'tribMun', 'tpRetISSQN'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'IssRetido']
      ]),
      aliquotaIss: this.extractFromPaths(xml, [
        ['infNFSe', 'valores', 'pAliqAplic'],
        ['valores', 'pAliqAplic'],
        ['InfNfse', 'ValoresNfse', 'Aliquota']
      ]) ?? this.extract(xml, ['aliquotaIss', 'aliquotaISS', 'pAliqAplic', 'pAliq', 'pAliquota']),
      tipoTributacaoIssqn: this.extractFromPaths(xml, [
        ['infDPS', 'valores', 'trib', 'tribMun', 'tribISSQN'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'ExigibilidadeISS']
      ]),
      municipioIncidenciaIssqn: this.composeLocalPrestacao(
        this.extractFromPaths(xml, [
          ['infDPS', 'valores', 'trib', 'tribMun', 'xLocIncid'],
          ['infNFSe', 'xLocIncid'],
          ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Servico', 'MunicipioIncidencia']
        ]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'UFIncid']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'cPaisResult']])
      ),
      regimeEspecialTributacaoIssqn: this.extractFromPaths(xml, [['infDPS', 'prest', 'regTrib', 'regEspTrib']]),
      tipoImunidadeIssqn: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'tpImunidade']]),
      suspensaoExigibilidadeIssqn: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'exigSusp', 'tpSusp']]),
      numeroProcessoSuspensaoIssqn: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'exigSusp', 'nProc']]),
      beneficioMunicipal: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'benefMun']]),
      calculoBeneficioMunicipal: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribMun', 'calcBM']]),
      valorIrrf,
      valorContribuicaoPrevidenciaria,
      valorContribuicoesSociais,
      valorPis,
      valorCofins,
      descricaoContribuicoesSociais: this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'tribFed', 'piscofins', 'tpRetPisCofins']]),
      cstClassTribIbsCbs: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'cClassTrib'], ['infDPS', 'IBSCBS', 'CST']]),
      indicadorOperacaoIbsCbs: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'cIndOp']]),
      municipioIncidenciaIbsCbs: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'xLocIncid']]),
      exclusoesReducoesBcIbsCbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'vDescIncond']]),
      baseCalculoAposExclusoesIbsCbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'vBC']]),
      reducaoAliquotaIbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'pRedAliqIBS']]),
      reducaoAliquotaCbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'pRedAliqCBS']]),
      aliquotaIbsEstadualMunicipal: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'pAliqIBSMunUF']]),
      aliquotaEfetivaIbsMunicipal: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'mun', 'pAliqEfetMun']]),
      valorApuradoIbsMunicipal: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'totCIBS', 'gIBS', 'gIBSMunTot', 'vIBSMun']]),
      aliquotaEfetivaIbsEstadual: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'uf', 'pAliqEfetUF']]),
      valorApuradoIbsEstadual: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'totCIBS', 'gIBS', 'gIBSUFTot', 'vIBSUF']]),
      valorTotalApuradoIbs: vIbsTot,
      aliquotaCbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'fed', 'pCBS']]),
      aliquotaEfetivaCbs: this.extractFromPaths(xml, [['infNFSe', 'IBSCBS', 'valores', 'fed', 'pAliqEfetCBS']]),
      valorTotalApuradoCbs: vCbs,
      codigoServicoNacional,
      codigoServicoMunicipal,
      codigoNbs: this.extractFromPaths(xml, [['infDPS', 'serv', 'cServ', 'cNBS']]),
      descricaoCodigoTributacao,
      itemListaServico: this.extract(xml, ['itemListaServico', 'ItemListaServico', 'cItemListaServ']),
      descricaoServico,
      infoComplementares: this.extractFromPaths(xml, [['infDPS', 'serv', 'infoCompl', 'xInfComp'], ['infDPS', 'serv', 'infoComp', 'xInfComp']]),
      chaveNfseSubstituida: this.extractFromPaths(xml, [['infDPS', 'subst', 'chSubstda'], ['infDPS', 'subst', 'chSubstda']]),
      documentoReferencia: this.extractFromPaths(xml, [['infDPS', 'subst', 'docRef']]),
      codigoObra: this.extractFromPaths(xml, [['infDPS', 'serv', 'obra', 'cObra']]),
      inscricaoImobiliaria: this.extractFromPaths(xml, [['infDPS', 'IBSCBS', 'imovel', 'inscImobFisc']]),
      codigoEvento: this.extractFromPaths(xml, [['infDPS', 'serv', 'atvEvento', 'idAtvEvt']]),
      documentoTecnico: this.extractFromPaths(xml, [['infDPS', 'serv', 'infoCompl', 'idDocTec']]),
      numeroPedido: this.extractFromPaths(xml, [['infDPS', 'serv', 'infoCompl', 'gItemPed', 'xPed']]),
      itemPedido: this.extractFromPaths(xml, [['infDPS', 'serv', 'infoCompl', 'gItemPed', 'xItemPed']]),
      infoAdministracaoMunicipal: this.extractFromPaths(xml, [['infDPS', 'serv', 'infoCompl', 'xOutInf']]),
      totaisAproximadosTributos: this.composeTotaisAproximadosTributos(
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'vTotTribFed']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'vTotTribEst']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'vTotTribMu']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'pTotTribFed']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'pTotTribEst']]),
        this.extractFromPaths(xml, [['infDPS', 'valores', 'trib', 'totTrib', 'pTotTribMu']])
      )
    };
  }

  private buildContentStreams(lines: string[], chaveAcesso: string): string[] {
    const page = { width: 595, height: 842 };
    const margin = 15;
    const contentX = margin + 5;
    const contentWidth = page.width - margin * 2 - 10;
    const layout = this.splitVisualBlocks(lines);
    const streams: string[] = [];

    const openPage = (pageNumber: number): { commands: string[]; yTop: number } => {
      const commands: string[] = [];
      let yTop = this.drawPageBase(commands, page, margin, pageNumber);
      yTop = this.drawVisualHeader(commands, layout.header, chaveAcesso, contentX, contentWidth, yTop, pageNumber);
      return { commands, yTop };
    };

    let pageNumber = 1;
    let current = openPage(pageNumber);

    for (const section of layout.sections) {
      const columns = this.getSectionColumns(section.title);
      const fields = this.parseSectionFields(section.title, section.rows, columns);
      const layoutRows = this.layoutSectionRows(fields, columns, contentWidth);
      const titleBarHeight = 8.4;
      const sectionPadding = 3.4;
      const lineHeight = 7.3;
      const labelGap = 0.9;
      const cellTopPadding = 2.1;
      const cellBottomPadding = 2;
      const sectionHeight =
        titleBarHeight +
        sectionPadding +
        layoutRows.reduce((acc, row) => {
          const rowHeight = row.reduce((maxHeight, cell) => {
            const labelHeight = cell.label ? lineHeight : 0;
            const valueHeight = cell.valueLines.length * lineHeight;
            const total = cellTopPadding + labelHeight + (cell.label ? labelGap : 0) + valueHeight + cellBottomPadding;
            return Math.max(maxHeight, total);
          }, 0);
          return acc + rowHeight;
        }, 0) +
        sectionPadding;

      if (current.yTop - sectionHeight < margin + 12) {
        this.drawText(
          current.commands,
          contentX + contentWidth - 110,
          margin + 6,
          '/F1',
          6.2,
          `Pagina ${pageNumber}`
        );
        streams.push(current.commands.join('\n'));
        pageNumber += 1;
        current = openPage(pageNumber);
      }

      this.drawLine(current.commands, contentX, current.yTop, contentX + contentWidth, current.yTop);
      this.drawText(current.commands, contentX + 3, current.yTop - 6.4, '/F2', 8.9, section.title);

      let rowTop = current.yTop - titleBarHeight - sectionPadding;
      const columnWidth = contentWidth / columns;
      for (let rowIndex = 0; rowIndex < layoutRows.length; rowIndex += 1) {
        const row = layoutRows[rowIndex];
        const rowHeight = row.reduce((maxHeight, cell) => {
          const labelHeight = cell.label ? lineHeight : 0;
          const valueHeight = cell.valueLines.length * lineHeight;
          const total = cellTopPadding + labelHeight + (cell.label ? labelGap : 0) + valueHeight + cellBottomPadding;
          return Math.max(maxHeight, total);
        }, 0);

        let colCursor = 0;
        for (const cell of row) {
          const spanWidth = columnWidth * cell.span;
          const cellX = contentX + colCursor * columnWidth;
          const textX = cellX + 2.6;

          let textY = rowTop - cellTopPadding - 4.8;
          if (cell.label) {
            this.drawText(current.commands, textX, textY, '/F2', 6, cell.label);
            textY -= lineHeight + labelGap;
          }
          for (const line of cell.valueLines) {
            this.drawText(current.commands, textX, textY, '/F1', 8.1, line);
            textY -= lineHeight;
          }

          colCursor += cell.span;
          if (spanWidth <= 0) {
            break;
          }
        }

        rowTop -= rowHeight;
      }

      this.drawLine(current.commands, contentX, rowTop - sectionPadding + 1.4, contentX + contentWidth, rowTop - sectionPadding + 1.4);

      current.yTop -= sectionHeight + 4;
    }

    this.drawText(current.commands, contentX + contentWidth - 110, margin + 6, '/F1', 6.2, `Pagina ${pageNumber}`);
    streams.push(current.commands.join('\n'));

    return streams;
  }

  private buildPdf(contentStreams: string[]): Buffer {
    const objectBodies: string[] = [];
    objectBodies.push('<< /Type /Catalog /Pages 2 0 R >>');

    const firstPageObjNum = 3;
    const kids: string[] = [];
    for (let i = 0; i < contentStreams.length; i += 1) {
      const pageObjNum = firstPageObjNum + i * 2;
      kids.push(`${pageObjNum} 0 R`);
    }
    objectBodies.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${contentStreams.length} >>`);

    for (let i = 0; i < contentStreams.length; i += 1) {
      const stream = `${contentStreams[i]}\n`;
      const streamBytes = Buffer.from(stream, 'latin1');
      const pageObj = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${firstPageObjNum + i * 2 + 1} 0 R /Resources << /Font << /F1 ${firstPageObjNum + contentStreams.length * 2} 0 R /F2 ${firstPageObjNum + contentStreams.length * 2 + 1} 0 R >> >> >>`;
      const contentObj = `<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`;
      objectBodies.push(pageObj);
      objectBodies.push(contentObj);
    }

    objectBodies.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objectBodies.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    const header = Buffer.from('%PDF-1.4\n', 'latin1');
    const objectBuffers = objectBodies.map((body, index) =>
      Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
    );

    const offsets: number[] = [];
    let cursor = header.length;
    for (const objectBuffer of objectBuffers) {
      offsets.push(cursor);
      cursor += objectBuffer.length;
    }

    const xrefOffset = cursor;
    const xrefLines = ['xref', `0 ${objectBodies.length + 1}`, '0000000000 65535 f '];
    for (const offset of offsets) {
      xrefLines.push(`${offset.toString().padStart(10, '0')} 00000 n `);
    }

    const trailer = [
      'trailer',
      `<< /Size ${objectBodies.length + 1} /Root 1 0 R >>`,
      'startxref',
      String(xrefOffset),
      '%%EOF'
    ].join('\n');

    return Buffer.concat([
      header,
      ...objectBuffers,
      Buffer.from(`${xrefLines.join('\n')}\n`, 'latin1'),
      Buffer.from(trailer, 'latin1')
    ]);
  }

  private splitVisualBlocks(lines: string[]): { header: string[]; sections: Array<{ title: string; rows: string[] }> } {
    const header: string[] = [];
    const sections: Array<{ title: string; rows: string[] }> = [];
    let current: { title: string; rows: string[] } | undefined;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        continue;
      }

      if (this.isSectionTitle(line)) {
        current = { title: line, rows: [] };
        sections.push(current);
        continue;
      }

      if (!current) {
        header.push(line);
      } else {
        current.rows.push(raw);
      }
    }

    return { header, sections };
  }

  private isSectionTitle(line: string): boolean {
    const titles = new Set([
      'DADOS DE IDENTIFICACAO DA NFS-E',
      'EMITENTE DA NFS-E',
      'TOMADOR DO SERVICO',
      'INTERMEDIARIO DO SERVICO',
      'DESTINATARIO DO SERVICO',
      'SERVICO PRESTADO',
      'TRIBUTACAO MUNICIPAL',
      'TRIBUTACAO FEDERAL',
      'TRIBUTACAO IBS/CBS',
      'VALOR TOTAL DA NFS-E',
      'TOTAIS APROXIMADOS DOS TRIBUTOS',
      'INFORMACOES COMPLEMENTARES'
    ]);

    return titles.has(line);
  }

  private expandSectionRows(rows: string[]): Array<{ label?: string; value: string }> {
    const expanded: Array<{ label?: string; value: string }> = [];

    for (const original of rows) {
      const raw = original.trimEnd();
      const trimmed = raw.trimStart();
      if (!trimmed) {
        continue;
      }

      const idx = trimmed.indexOf(':');
      if (idx > 0 && !trimmed.startsWith('http')) {
        const label = trimmed.slice(0, idx + 1);
        const value = trimmed.slice(idx + 1).trim();
        const wrapped = this.wrapText(value || '-', 78);
        expanded.push({ label, value: wrapped[0] });
        for (let i = 1; i < wrapped.length; i += 1) {
          expanded.push({ value: wrapped[i] });
        }
      } else {
        const wrapped = this.wrapText(trimmed, 95);
        for (const value of wrapped) {
          expanded.push({ value });
        }
      }
    }

    return expanded;
  }

  private drawText(commands: string[], x: number, y: number, font: '/F1' | '/F2', size: number, text: string): void {
    commands.push('BT');
    commands.push(`${font} ${size.toFixed(2)} Tf`);
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
    commands.push(`(${this.escapePdfText(text)}) Tj`);
    commands.push('ET');
  }

  private drawRect(commands: string[], x: number, y: number, width: number, height: number, grayFill?: number): void {
    if (grayFill !== undefined) {
      commands.push(`${grayFill.toFixed(2)} g`);
      commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
      commands.push('0 g');
    }
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  }

  private drawLine(commands: string[], x1: number, y1: number, x2: number, y2: number): void {
    commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  private drawPageBase(
    commands: string[],
    page: { width: number; height: number },
    margin: number,
    pageNumber: number
  ): number {
    commands.push('0 G');
    commands.push('0.7 w');
    commands.push(`${margin} ${margin} ${page.width - margin * 2} ${page.height - margin * 2} re S`);
    this.drawText(commands, margin + 6, margin + 6, '/F1', 6.1, `DANFSE - pagina ${pageNumber}`);
    return page.height - margin - 6;
  }

  private drawVisualHeader(
    commands: string[],
    header: string[],
    chaveAcesso: string,
    contentX: number,
    contentWidth: number,
    yTop: number,
    pageNumber: number
  ): number {
    const headerHeight = pageNumber === 1 ? 74 : 40;
    this.drawRect(commands, contentX, yTop - headerHeight, contentWidth, headerHeight, 0.98);
    this.drawRect(commands, contentX, yTop - headerHeight, contentWidth, headerHeight);

    const stripHeight = 13;
    this.drawRect(commands, contentX, yTop - stripHeight, contentWidth, stripHeight, 0.82);
    this.drawRect(commands, contentX, yTop - stripHeight, contentWidth, stripHeight);

    const title = header[0] ?? 'DANFSe';
    const subtitle = header[1] ?? 'Documento Auxiliar da NFS-e';
    this.drawText(commands, contentX + 4, yTop - 8.8, '/F2', 9.4, title);
    this.drawText(commands, contentX + 146, yTop - 8.8, '/F1', 6.9, subtitle);
    this.drawText(commands, contentX + contentWidth - 38, yTop - 8.8, '/F2', 7, `P${pageNumber}`);

    if (pageNumber === 1) {
      const logoX = contentX + 4;
      const logoY = yTop - stripHeight - 3;
      this.drawLogo(commands, logoX, logoY);

      const qrSize = 47;
      const qrX = contentX + contentWidth - qrSize - 5;
      const qrY = yTop - headerHeight + 6;
      this.drawPseudoQr(commands, qrX, qrY, qrSize, chaveAcesso);
      this.drawText(commands, qrX + 13, qrY - 6, '/F1', 5.6, 'CONSULTA');

      const infoX = logoX + 77;
      const infoYTop = yTop - stripHeight - 5;
      const infoWidth = contentWidth - 77 - qrSize - 14;
      this.drawRect(commands, infoX, yTop - headerHeight + 6, infoWidth, headerHeight - stripHeight - 10);

      const metadataLines = this.pickHeaderMetadata(header);
      let lineY = infoYTop - 2;
      for (let i = 0; i < metadataLines.length && lineY > yTop - headerHeight + 12; i += 1) {
        const font = i <= 1 ? '/F2' : '/F1';
        const size = i <= 1 ? 6.5 : 6.1;
        this.drawText(commands, infoX + 4, lineY, font, size, metadataLines[i]);
        lineY -= 6.8;
      }
    } else {
      this.drawText(commands, contentX + 6, yTop - 22, '/F1', 6.5, `Chave: ${chaveAcesso}`);
    }

    return yTop - headerHeight - 4;
  }

  private getSectionColumns(title: string): number {
    if (title === 'DADOS DE IDENTIFICACAO DA NFS-E') {
      return 3;
    }
    if (title === 'INTERMEDIARIO DO SERVICO' || title === 'INFORMACOES COMPLEMENTARES') {
      return 1;
    }
    if (title === 'TOTAIS APROXIMADOS DOS TRIBUTOS') {
      return 3;
    }
    return 4;
  }

  private parseSectionFields(
    title: string,
    rows: string[],
    columns: number
  ): Array<{ label?: string; value: string; span: number }> {
    const fields: Array<{ label?: string; value: string; span: number }> = [];

    const setSpan = (label?: string): number => {
      if (!label) {
        return columns;
      }
      const fullWidthLabels = new Set([
        'Chave de Acesso da NFS-e:',
        'Consulta Publica:',
        'Descricao do Codigo de Tributacao:',
        'Descricao do Servico:',
        'Informacoes Complementares:',
        'Lei n 12.741/2012:'
      ]);
      if (fullWidthLabels.has(label)) {
        return columns;
      }

      const wideLabels = new Set([
        'Nome / Nome Empresarial:',
        'Endereco:',
        'E-mail:',
        'Simples Nacional na Data de Competencia:',
        'Regime de Apuracao Tributaria pelo SN:',
        'Total das Retencoes (ISSQN / Federais):',
        'Valor Liquido da NFS-e:',
        'Valor Liquido da NFS-e + IBS/CBS:'
      ]);
      if (wideLabels.has(label)) {
        return Math.min(columns, 2);
      }

      if (title === 'DADOS DE IDENTIFICACAO DA NFS-E') {
        if (label === 'Codigo de Verificacao:') {
          return Math.min(columns, 2);
        }
      }
      return 1;
    };

    for (const original of rows) {
      const raw = original.trimEnd();
      const trimmed = raw.trimStart();
      if (!trimmed) {
        continue;
      }

      if (raw.startsWith('  ') && fields.length > 0) {
        fields[fields.length - 1].value = `${fields[fields.length - 1].value} ${trimmed}`.trim();
        continue;
      }

      const idx = trimmed.indexOf(':');
      if (idx > 0 && !trimmed.startsWith('http')) {
        const label = trimmed.slice(0, idx + 1);
        const value = trimmed.slice(idx + 1).trim() || '-';
        fields.push({
          label,
          value,
          span: setSpan(label)
        });
      } else {
        fields.push({
          value: trimmed,
          span: columns
        });
      }
    }

    return fields;
  }

  private layoutSectionRows(
    fields: Array<{ label?: string; value: string; span: number }>,
    columns: number,
    contentWidth: number
  ): Array<Array<{ label?: string; valueLines: string[]; span: number }>> {
    const rows: Array<Array<{ label?: string; valueLines: string[]; span: number }>> = [];
    let current: Array<{ label?: string; valueLines: string[]; span: number }> = [];
    let used = 0;

    for (const field of fields) {
      const span = Math.max(1, Math.min(columns, field.span));
      if (used + span > columns && current.length > 0) {
        rows.push(current);
        current = [];
        used = 0;
      }

      const avgCharsPerColumn = Math.max(16, Math.floor((contentWidth / columns) / 3.3));
      const widthChars = Math.max(12, avgCharsPerColumn * span - 2);
      const valueLines = this.wrapText(field.value, widthChars);

      current.push({
        label: field.label,
        valueLines,
        span
      });
      used += span;

      if (used === columns) {
        rows.push(current);
        current = [];
        used = 0;
      }
    }

    if (current.length > 0) {
      rows.push(current);
    }

    return rows;
  }

  private drawLogo(commands: string[], x: number, yTop: number): void {
    const w = 74;
    const h = 54;
    this.drawRect(commands, x, yTop - h, w, h, 0.98);
    this.drawRect(commands, x, yTop - h, w, h);
    this.drawText(commands, x + 7, yTop - 16, '/F2', 18, 'NFS-e');
    this.drawText(commands, x + 7, yTop - 28, '/F1', 6.4, 'Padrao Nacional');
    this.drawText(commands, x + 7, yTop - 36, '/F1', 6.4, 'Documento Fiscal');
    this.drawText(commands, x + 7, yTop - 44, '/F1', 6.4, 'Eletronico');
    this.drawText(commands, x + 7, yTop - 51, '/F1', 5.8, 'Versao oficial');
  }

  private drawPseudoQr(commands: string[], x: number, y: number, size: number, seed: string): void {
    this.drawRect(commands, x, y, size, size, 1);
    const qr = QRCode.create(seed, { errorCorrectionLevel: 'M' });
    const quietZone = 4;
    const modules = qr.modules;
    const cell = size / (modules.size + quietZone * 2);

    for (let row = 0; row < modules.size; row += 1) {
      for (let col = 0; col < modules.size; col += 1) {
        if (!modules.get(row, col)) {
          continue;
        }

        const px = x + (col + quietZone) * cell;
        const py = y + size - (row + quietZone + 1) * cell;
        commands.push('0 g');
        commands.push(`${px.toFixed(2)} ${py.toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
      }
    }

    this.drawRect(commands, x, y, size, size);
    commands.push('0 g');
  }

  private pickHeaderMetadata(header: string[]): string[] {
    const preferred = [
      'MUNICIPIO ',
      'Chave de Acesso da NFS-e:',
      'Numero da NFS-e:',
      'Data e Hora da emissao da NFS-e:',
      'Competencia da NFS-e:',
      'Situacao da NFS-e:',
      'Codigo de Verificacao:',
      'Tipo de Ambiente:',
      'Consulta Publica:'
    ];

    const selected: string[] = [];
    for (const prefix of preferred) {
      const found = header.find((line) => line.startsWith(prefix));
      if (found && !selected.includes(found)) {
        selected.push(found);
      }
    }

    return selected.slice(0, 8);
  }

  private wrapText(value: string, maxLen: number): string[] {
    const normalized = this.normalizePrintable(value);
    if (!normalized) {
      return ['-'];
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLen) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }
      current = word.slice(0, maxLen);
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  private escapePdfText(value: string): string {
    return this.normalizePrintable(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  private normalizePrintable(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .trim();
  }

  private normalizeChaveAcesso(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 50) {
      return digits.slice(0, 50);
    }
    return digits || this.safeValue(value);
  }

  private safeValue(value?: string | number | null): string {
    if (value === undefined || value === null) {
      return '-';
    }

    const raw = String(value).trim();
    if (!raw) {
      return '-';
    }

    return this.normalizePrintable(raw);
  }

  private combineSlash(left?: string | null, right?: string | null): string {
    const first = this.safeValue(left);
    const second = this.safeValue(right);

    if (first === '-' && second === '-') {
      return '-';
    }
    if (first === '-') {
      return second;
    }
    if (second === '-') {
      return first;
    }

    return `${first} / ${second}`;
  }

  private hasIdentificacao(cpfCnpj?: string | null, nome?: string | null, endereco?: string | null): boolean {
    return this.safeValue(cpfCnpj) !== '-' || this.safeValue(nome) !== '-' || this.safeValue(endereco) !== '-';
  }

  private isDestinatarioIgualTomador(input: DanfseRenderInput): boolean {
    const dest = this.safeValue(input.cnpjDestinatario);
    const toma = this.safeValue(input.cnpjTomador);
    if (dest === '-' || toma === '-') {
      return false;
    }
    return dest === toma;
  }

  private isOperacaoNaoSujeitaIss(tipoTributacaoIssqn?: string | null): boolean {
    const normalized = this.safeValue(tipoTributacaoIssqn).toLowerCase();
    if (normalized === '-') {
      return false;
    }
    return normalized.includes('nao sujeita') || normalized === '4';
  }

  private isHomologacao(tipoAmbiente?: string | null): boolean {
    const normalized = this.safeValue(tipoAmbiente).toLowerCase();
    return normalized === '2' || normalized.includes('homolog');
  }

  private isCancelada(status?: string | null): boolean {
    const normalized = this.safeValue(status).toLowerCase();
    return normalized === '101' || normalized.includes('cancel');
  }

  private isSubstituida(status?: string | null, chaveSubstituida?: string | null): boolean {
    if (this.safeValue(chaveSubstituida) !== '-') {
      return true;
    }
    const normalized = this.safeValue(status).toLowerCase();
    return normalized.includes('substitu');
  }

  private describeEmitente(value?: string | null): string {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return '-';
    }

    if (normalized === '1') {
      return 'Prestador';
    }
    if (normalized === '2') {
      return 'Tomador';
    }
    if (normalized === '3') {
      return 'Intermediario';
    }

    return normalized;
  }

  private composeInformacoesComplementares(input: DanfseRenderInput): string {
    const chunks: string[] = [];
    const push = (label: string, value?: string | null) => {
      const normalized = this.safeValue(value);
      if (normalized !== '-') {
        chunks.push(`${label}: ${normalized}`);
      }
    };

    push('Inf. Cont.', input.infoComplementares);
    push('NFS-e Subst.', input.chaveNfseSubstituida);
    push('Doc. Ref.', input.documentoReferencia);
    push('Cod. Obra', input.codigoObra);
    push('Insc. Imob.', input.inscricaoImobiliaria);
    push('Cod. Evt.', input.codigoEvento);
    push('Doc. Tec.', input.documentoTecnico);
    push('Num. Ped.', input.numeroPedido);
    push('Item Ped.', input.itemPedido);
    push('Inf. A. T. Mun.', input.infoAdministracaoMunicipal);

    const totaisAproximados =
      this.safeValue(input.totaisAproximadosTributos) !== '-'
        ? this.safeValue(input.totaisAproximadosTributos)
        : 'Totais Aproximados dos Tributos cfe. Lei n 12.741/2012: Federais: - ; Estaduais: - ; Municipais: -';
    chunks.push(totaisAproximados);

    return chunks.join(' | ');
  }

  private composeTotaisAproximadosTributos(
    vFed?: string,
    vEst?: string,
    vMun?: string,
    pFed?: string,
    pEst?: string,
    pMun?: string
  ): string | undefined {
    const hasValores = [vFed, vEst, vMun].some((value) => this.safeValue(value) !== '-');
    const hasPercentuais = [pFed, pEst, pMun].some((value) => this.safeValue(value) !== '-');

    if (!hasValores && !hasPercentuais) {
      return undefined;
    }

    if (hasValores) {
      return `Totais Aproximados dos Tributos cfe. Lei n 12.741/2012: Federais: ${this.safeValue(vFed)} ; Estaduais: ${this.safeValue(vEst)} ; Municipais: ${this.safeValue(vMun)}`;
    }

    return `Totais Aproximados dos Tributos cfe. Lei n 12.741/2012: Federais: ${this.formatPercentSpacing(this.safeValue(pFed))} ; Estaduais: ${this.formatPercentSpacing(this.safeValue(pEst))} ; Municipais: ${this.formatPercentSpacing(this.safeValue(pMun))}`;
  }

  private composeAddress(xml: string, basePaths: string[][]): string | undefined {
    for (const basePath of basePaths) {
      const logradouro =
        this.extractFromPath(xml, [...basePath, 'xLgr']) ??
        this.extractFromPath(xml, [...basePath, 'Endereco']);
      const numero =
        this.extractFromPath(xml, [...basePath, 'nro']) ??
        this.extractFromPath(xml, [...basePath, 'Numero']);
      const complemento =
        this.extractFromPath(xml, [...basePath, 'xCpl']) ??
        this.extractFromPath(xml, [...basePath, 'Complemento']);
      const bairro =
        this.extractFromPath(xml, [...basePath, 'xBairro']) ??
        this.extractFromPath(xml, [...basePath, 'Bairro']);

      const value = [logradouro, numero, complemento, bairro]
        .map((item) => this.safeValue(item))
        .filter((item) => item !== '-')
        .join(', ');

      if (value) {
        return value;
      }

      if (basePath[basePath.length - 1] === 'Endereco') {
        const parentPath = basePath.slice(0, -1);
        const scopedLogradouro = this.extractFromParentPaths(xml, [parentPath], ['Endereco']);
        const scopedNumero = this.extractFromParentPaths(xml, [parentPath], ['Numero']);
        const scopedComplemento = this.extractFromParentPaths(xml, [parentPath], ['Complemento']);
        const scopedBairro = this.extractFromParentPaths(xml, [parentPath], ['Bairro']);
        const scopedValue = [scopedLogradouro, scopedNumero, scopedComplemento, scopedBairro]
          .map((item) => this.safeValue(item))
          .filter((item) => item !== '-')
          .join(', ');

        if (scopedValue) {
          return scopedValue;
        }
      }
    }

    return undefined;
  }

  private composeMunicipioUf(
    codigoMunicipio?: string,
    uf?: string,
    nomeMunicipio?: string
  ): string | undefined {
    const nome = this.safeValue(nomeMunicipio);
    const codigo = this.safeValue(codigoMunicipio);
    const ufNormalized = this.safeValue(uf);

    if (nome !== '-' && ufNormalized !== '-') {
      return `${nome} / ${ufNormalized}`;
    }
    if (nome !== '-') {
      return nome;
    }
    if (codigo !== '-' && ufNormalized !== '-') {
      return `${codigo} / ${ufNormalized}`;
    }
    if (codigo !== '-') {
      return codigo;
    }

    return undefined;
  }

  private composeIbgeCep(codigoIbge?: string, cep?: string): string | undefined {
    const ibge = this.safeValue(codigoIbge);
    const cepValue = this.safeValue(cep);
    if (ibge === '-' && cepValue === '-') {
      return undefined;
    }
    if (ibge === '-') {
      return cepValue;
    }
    if (cepValue === '-') {
      return ibge;
    }
    return `${ibge} / ${cepValue}`;
  }

  private composeLocalPrestacao(local?: string, uf?: string, pais?: string): string | undefined {
    const parts = [this.safeValue(local), this.safeValue(uf), this.safeValue(pais)].filter((part) => part !== '-');
    if (!parts.length) {
      return undefined;
    }
    return parts.join(' / ');
  }

  private sumValues(first?: string | null, second?: string | null): string | undefined {
    const firstValue = this.toNumber(first);
    const secondValue = this.toNumber(second);
    if (firstValue === undefined && secondValue === undefined) {
      return undefined;
    }
    return ((firstValue ?? 0) + (secondValue ?? 0)).toFixed(2);
  }

  private hasIbsCbsData(input: DanfseRenderInput): boolean {
    const values = [
      input.valorTotalIbscbs,
      input.valorLiquidoComIbscbs,
      input.valorTotalApuradoIbs,
      input.valorTotalApuradoCbs,
      input.cstClassTribIbsCbs,
      input.aliquotaCbs
    ];
    return values.some((value) => this.safeValue(value) !== '-');
  }

  private totalRetencoesFederais(input: DanfseRenderInput): string | undefined {
    const irrf = this.toNumber(input.valorIrrf);
    const cp = this.toNumber(input.valorContribuicaoPrevidenciaria);
    const cs = this.toNumber(input.valorContribuicoesSociais);
    const total = (irrf ?? 0) + (cp ?? 0) + (cs ?? 0);
    if (total === 0 && irrf === undefined && cp === undefined && cs === undefined) {
      return undefined;
    }
    return total.toFixed(2);
  }

  private pushRetentionAmountEntry(
    entries: NfseRetentionAlertEntry[],
    code: NfseRetentionAlertEntry['code'],
    label: string,
    rawValue?: string | null
  ): void {
    const amount = this.formatMoney(rawValue);
    if (!amount) {
      return;
    }

    entries.push({ code, label, amount });
  }

  private formatCpfCnpj(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length === 14) {
      return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (digits.length === 11) {
      return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return value;
  }

  private formatCep(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length === 8) {
      return digits.replace(/^(\d{5})(\d{3})$/, '$1-$2');
    }
    if (digits.length > 8) {
      const last = digits.slice(-8);
      return last.replace(/^(\d{5})(\d{3})$/, '$1-$2');
    }
    return value;
  }

  private formatPhone(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    return value;
  }

  private formatMunicipioUfLabel(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    return value.replace(/\s*\/\s*/g, ' - ');
  }

  private formatDateBr(value?: Date | null): string {
    if (!value) {
      return '-';
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    return formatter.format(parsed).replace(',', '');
  }

  private formatDateOnlyBr(value?: Date | null): string {
    if (!value) {
      return '-';
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private formatMoney(value?: string | number | null): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const parsed =
      typeof value === 'number'
        ? value
        : this.toNumber(value) ??
          this.toNumber(
            String(value)
              .replace(/\s/g, '')
              .replace('R$', '')
          );
    if (parsed === undefined || Number.isNaN(parsed)) {
      return undefined;
    }
    const formatted = parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R$ ${formatted}`;
  }

  private formatAliquota(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized.includes('%')) {
      return this.formatPercentSpacing(normalized);
    }
    const parsed = this.toNumber(normalized);
    if (parsed === undefined) {
      return normalized;
    }
    return `${parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} %`;
  }

  private describeRetencaoIss(value?: string | null, valorIssRetido?: string | null): string | undefined {
    const valorRetido = this.toNumber(valorIssRetido);
    if (valorRetido !== undefined && valorRetido > 0) {
      return 'Retido';
    }

    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return undefined;
    }
    if (normalized === '1') {
      return 'Retido';
    }
    if (normalized === '2') {
      return 'Nao Retido';
    }
    return normalized;
  }

  private detectLeituraFiscalLayout(xml: string): NfseLeituraFiscal['layout'] {
    if (
      /<(?:\w+:)?CompNfse\b/.test(xml) ||
      /<(?:\w+:)?InfNfse\b/.test(xml) ||
      /<(?:\w+:)?DeclaracaoPrestacaoServico\b/.test(xml) ||
      /abrasf/i.test(xml)
    ) {
      return 'abrasf';
    }

    if (
      /<(?:\w+:)?infDPS\b/.test(xml) ||
      /<(?:\w+:)?DPS\b/.test(xml) ||
      /<(?:\w+:)?infNFSe\b/.test(xml) ||
      /sped\.fazenda\.gov\.br\/nfse/i.test(xml)
    ) {
      return 'padrao_nacional';
    }

    return 'desconhecido';
  }

  private toFixedCurrencyString(value?: number | null): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    return value.toFixed(2);
  }

  private toFixedRateString(value?: number | null): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    return value.toFixed(2);
  }

  private describeTributacaoIssqn(value?: string | null): string | undefined {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return undefined;
    }
    if (normalized === '1') {
      return 'Operacao Tributavel';
    }
    if (normalized === '2') {
      return 'Operacao sem incidencia';
    }
    if (normalized === '3') {
      return 'Imunidade';
    }
    if (normalized === '4') {
      return 'Operacao nao sujeita ao ISSQN';
    }
    return normalized;
  }

  private describeSuspensao(value?: string | null): string | undefined {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return undefined;
    }
    if (normalized === '0') {
      return 'Nao';
    }
    if (normalized === '1') {
      return 'Sim';
    }
    return normalized;
  }

  private describeSimplesNacional(value?: string | null): string | undefined {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return undefined;
    }
    if (normalized === '1') {
      return 'Optante';
    }
    if (normalized === '2') {
      return 'Nao Optante';
    }
    return normalized;
  }

  private extractPais(value?: string | null): string | undefined {
    const normalized = this.safeValue(value);
    if (normalized === '-') {
      return undefined;
    }
    const parts = normalized.split('/').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 2) {
      return parts[parts.length - 1];
    }
    if (parts.length === 2 && !/^[A-Z]{2}$/i.test(parts[1])) {
      return parts[1];
    }
    const hyphenParts = normalized.split('-');
    if (hyphenParts.length > 2) {
      return hyphenParts[hyphenParts.length - 1].trim();
    }
    return undefined;
  }

  private formatDate(value?: Date | null): string {
    if (!value) {
      return '-';
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    const yyyy = parsed.getUTCFullYear();
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    const hh = String(parsed.getUTCHours()).padStart(2, '0');
    const mi = String(parsed.getUTCMinutes()).padStart(2, '0');
    const ss = String(parsed.getUTCSeconds()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed;
  }

  private extract(xml: string, tags: string[]): string | undefined {
    for (const tag of tags) {
      const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const match = xml.match(regex);
      if (match?.[1]) {
        const cleaned = this.cleanText(match[1]);
        if (cleaned) {
          return cleaned;
        }
      }
    }

    return undefined;
  }

  private extractFromPaths(xml: string, paths: string[][]): string | undefined {
    for (const path of paths) {
      const value = this.extractFromPath(xml, path);
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  private extractFromParentPaths(xml: string, parentPaths: string[][], childTags: string[]): string | undefined {
    for (const parentPath of parentPaths) {
      const scope = this.extractScope(xml, parentPath);
      if (!scope) {
        continue;
      }

      for (const childTag of childTags) {
        const regex = new RegExp(`<(?:\\w+:)?${childTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${childTag}>`, 'i');
        const match = scope.match(regex);
        if (!match?.[1]) {
          continue;
        }

        const cleaned = this.cleanText(match[1]);
        if (cleaned) {
          return cleaned;
        }
      }
    }

    return undefined;
  }

  private extractFromPath(xml: string, path: string[]): string | undefined {
    const scope = this.extractScope(xml, path.slice(0, -1));
    if (scope === undefined) {
      return undefined;
    }

    const finalTag = path[path.length - 1];
    const finalRegex = new RegExp(`<(?:\\w+:)?${finalTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${finalTag}>`, 'i');
    const finalMatch = scope.match(finalRegex);
    if (!finalMatch?.[1]) {
      return undefined;
    }

    return this.cleanText(finalMatch[1]);
  }

  private extractScope(xml: string, path: string[]): string | undefined {
    if (!path.length) {
      return xml;
    }

    let scope = xml;
    for (let i = 0; i < path.length; i += 1) {
      const parentRegex = new RegExp(
        `<(?:\\w+:)?${path[i]}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${path[i]}>`,
        'i'
      );
      const parentMatch = scope.match(parentRegex);
      if (!parentMatch?.[1]) {
        return undefined;
      }
      scope = parentMatch[1];
    }

    return scope;
  }

  private extractNestedAny(xml: string, parentTags: string[], childTags: string[]): string | undefined {
    for (const parentTag of parentTags) {
      const value = this.extractNested(xml, parentTag, childTags);
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  private extractNested(xml: string, parentTag: string, childTags: string[]): string | undefined {
    const parentRegex = new RegExp(
      `<(?:\\w+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${parentTag}>`,
      'ig'
    );
    const parentMatch = parentRegex.exec(xml);
    if (!parentMatch?.[1]) {
      return undefined;
    }

    for (const childTag of childTags) {
      const childRegex = new RegExp(
        `<(?:\\w+:)?${childTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${childTag}>`,
        'i'
      );
      const childMatch = parentMatch[1].match(childRegex);
      const cleaned = childMatch?.[1] ? this.cleanText(childMatch[1]) : undefined;
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private cleanText(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .trim();
  }

  private parseDateOnly(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const [yearRaw, monthRaw, dayRaw] = value.slice(0, 10).split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!year || !month || !day) {
      return undefined;
    }

    return new Date(Date.UTC(year, month - 1, day));
  }

  private toNumber(value?: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const normalized =
      trimmed.includes(',') && trimmed.includes('.')
        ? trimmed.replace(/\./g, '').replace(',', '.')
        : trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return parsed;
  }

  private formatDateOnly(value?: Date | null): string {
    if (!value) {
      return '-';
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    const yyyy = parsed.getUTCFullYear();
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private mergeDefined(
    extracted: Omit<DanfseRenderInput, 'chaveAcesso'>,
    fallback: DanfseRenderInput
  ): Omit<DanfseRenderInput, 'chaveAcesso'> {
    const merged = { ...fallback } as Record<string, unknown>;
    const extractedEntries = Object.entries(extracted) as Array<[keyof DanfseRenderInput, unknown]>;

    for (const [key, value] of extractedEntries) {
      if (!this.hasRenderableValue(value)) {
        continue;
      }

      const currentValue = merged[key];
      if (!this.hasRenderableValue(currentValue) || this.shouldPreferExtractedValue(key, value, currentValue)) {
        merged[key] = value;
      }
    }

    delete merged.chaveAcesso;
    return merged as Omit<DanfseRenderInput, 'chaveAcesso'>;
  }

  private hasRenderableValue(value: unknown): boolean {
    if (value instanceof Date) {
      return !Number.isNaN(value.getTime());
    }
    if (typeof value === 'string') {
      return value.trim() !== '' && value.trim() !== '-';
    }
    return value !== undefined && value !== null;
  }

  private shouldPreferExtractedValue(
    key: keyof DanfseRenderInput,
    extractedValue: unknown,
    fallbackValue: unknown
  ): boolean {
    if (extractedValue instanceof Date) {
      return true;
    }
    if (typeof extractedValue !== 'string') {
      return true;
    }
    if (typeof fallbackValue !== 'string') {
      return true;
    }

    if (
      this.isMunicipioLikeField(key) &&
      this.looksLikeCodigoSemDescricao(extractedValue) &&
      this.looksLikeDescricaoMunicipio(fallbackValue)
    ) {
      return false;
    }

    return true;
  }

  private isMunicipioLikeField(key: keyof DanfseRenderInput): boolean {
    return (
      key === 'municipioPrestador' ||
      key === 'municipioTomador' ||
      key === 'municipioDestinatario' ||
      key === 'municipioIntermediario' ||
      key === 'localPrestacao' ||
      key === 'municipioIncidenciaIssqn'
    );
  }

  private looksLikeCodigoSemDescricao(value: string): boolean {
    const normalized = value.trim();
    return /^[0-9.\-/\s]+$/.test(normalized) || /^[0-9.\-/\s]+(?:[-/]\s*[A-Z]{2})$/.test(normalized);
  }

  private looksLikeDescricaoMunicipio(value: string): boolean {
    return /[A-Za-zÀ-ÿ]/.test(value);
  }

  private normalizeMunicipioDisplayFields<T extends Partial<DanfseRenderInput>>(input: T): T {
    const nomeMunicipio = this.safeValue(input.municipioPrestacaoNome);
    const codigoMunicipio = this.safeValue(input.municipioPrestacaoCodigo);

    if (nomeMunicipio === '-') {
      return input;
    }

    return {
      ...input,
      municipioPrestador: this.replaceMunicipioCodeWithName(input.municipioPrestador, nomeMunicipio, codigoMunicipio),
      municipioTomador: this.replaceMunicipioCodeWithName(input.municipioTomador, nomeMunicipio, codigoMunicipio),
      municipioDestinatario: this.replaceMunicipioCodeWithName(input.municipioDestinatario, nomeMunicipio, codigoMunicipio),
      municipioIntermediario: this.replaceMunicipioCodeWithName(input.municipioIntermediario, nomeMunicipio, codigoMunicipio),
      localPrestacao: this.replaceMunicipioCodeWithName(input.localPrestacao, nomeMunicipio, codigoMunicipio),
      municipioIncidenciaIssqn: this.replaceMunicipioCodeWithName(
        input.municipioIncidenciaIssqn,
        nomeMunicipio,
        codigoMunicipio
      )
    } as T;
  }

  private replaceMunicipioCodeWithName(
    value: string | null | undefined,
    municipioNome: string,
    expectedCode?: string
  ): string | undefined {
    const normalizedValue = this.safeValue(value);
    if (normalizedValue === '-') {
      return undefined;
    }

    const codeMatch = normalizedValue.match(/^\s*([0-9]{6,7})(.*)$/);
    if (!codeMatch) {
      return value ?? undefined;
    }

    const codigo = codeMatch[1];
    const suffix = codeMatch[2] ?? '';
    const normalizedExpected = this.safeValue(expectedCode);

    if (normalizedExpected !== '-' && codigo !== normalizedExpected) {
      return value ?? undefined;
    }

    return `${municipioNome}${suffix}`;
  }
}
