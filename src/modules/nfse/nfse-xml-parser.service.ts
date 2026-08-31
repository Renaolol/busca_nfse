import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { resolveMunicipioIbge } from '../../common/utils/municipio-ibge.util';

export interface ParsedNfse {
  chaveAcesso: string;
  tpAmb?: string;
  numeroNfse?: string;
  serie?: string;
  dpsId?: string;
  numeroDps?: string;
  serieDps?: string;
  dataEmissao?: Date;
  competencia?: Date;
  status?: string;
  cnpjPrestador?: string;
  razaoSocialPrestador?: string;
  cnpjTomador?: string;
  razaoSocialTomador?: string;
  municipioTomador?: string;
  municipioPrestacaoCodigo?: string;
  municipioPrestacaoNome?: string;
  localPrestacao?: string;
  valorServico?: string;
  valorDeducoes?: string;
  valorIss?: string;
  retencaoIss?: string;
  aliquotaIss?: string;
  codigoServicoNacional?: string;
  itemListaServico?: string;
  descricaoServico?: string;
  chaveSubstituida?: string;
  motivoSubstituicao?: string;
}

export interface ParsedNfseEvento {
  chaveAcesso: string;
  tipoEvento: string;
  dataEvento?: Date;
  descricao?: string;
  cnpjAutor?: string;
  motivo?: string;
  idEvento?: string;
  numeroSequencial?: string;
  isCancelamento: boolean;
}

export type ParsedNfseXml =
  | {
      kind: 'nfse';
      nfse: ParsedNfse;
    }
  | {
      kind: 'evento';
      evento: ParsedNfseEvento;
    };

@Injectable()
export class NfseXmlParserService {
  parseAny(xml: string): ParsedNfseXml {
    if (this.isEventoXml(xml)) {
      return {
        kind: 'evento',
        evento: this.parseEvento(xml)
      };
    }

    return {
      kind: 'nfse',
      nfse: this.parse(xml)
    };
  }

  parse(xml: string): ParsedNfse {
    const chaveAcesso = this.extractChaveAcesso(xml);

    if (!chaveAcesso) {
      throw new Error('Nao foi possivel localizar chave de acesso no XML');
    }

    return {
      chaveAcesso,
      tpAmb: this.extract(xml, ['tpAmb']),
      numeroNfse: this.extract(xml, ['numeroNFSe', 'numeroNfse', 'Numero', 'nNFSe']),
      serie: this.extract(xml, ['serie']),
      dpsId: this.extractDpsId(xml),
      numeroDps: this.extract(xml, ['nDPS']) ?? this.extractNumeroDpsFromId(this.extractDpsId(xml)),
      serieDps: this.extractNestedAny(xml, ['DPS'], ['serie']) ?? this.extract(xml, ['serie']),
      dataEmissao: this.parseDate(this.extract(xml, ['dataEmissao', 'DataEmissao', 'dhEmi', 'dhProc'])),
      competencia: this.parseDateOnly(this.extract(xml, ['competencia', 'dCompet'])),
      status: this.extract(xml, ['status', 'Situacao', 'cStat']),
      cnpjPrestador:
        this.normalizeCnpj(this.extract(xml, ['CnpjPrestador'])) ??
        this.normalizeCnpj(
          this.extractNestedAny(
            xml,
            ['emit', 'prestador', 'prest', 'PrestadorServico', 'Prestador'],
            ['CNPJ', 'cnpj', 'Cnpj', 'CpfCnpj', 'CPF']
          )
        ),
      razaoSocialPrestador: this.extractNestedAny(
        xml,
        ['emit', 'prestador', 'prest', 'PrestadorServico', 'Prestador'],
        ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome', 'NomeFantasia']
      ),
      cnpjTomador: this.normalizeCnpj(
        this.extractNestedAny(
          xml,
          ['tomador', 'toma', 'Tomador', 'TomadorServico'],
          ['CNPJ', 'cnpj', 'Cnpj', 'CpfCnpj', 'CPF']
        )
      ),
      razaoSocialTomador: this.extractNestedAny(
        xml,
        ['tomador', 'toma', 'Tomador', 'TomadorServico'],
        ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome', 'NomeFantasia']
      ),
      municipioTomador: this.extractMunicipioTomador(xml),
      localPrestacao:
        this.extractNestedAny(xml, ['locPrest'], ['xLocPrestacao']) ??
        this.extract(xml, ['localPrestacao', 'xLocPrestacao']),
      municipioPrestacaoCodigo:
        this.extract(xml, ['municipioPrestacaoCodigo', 'codigoMunicipioPrestacao', 'cLocPrestacao']) ??
        this.extractNestedAny(xml, ['locPrest'], ['cLocPrestacao']),
      municipioPrestacaoNome:
        this.extract(xml, ['municipioPrestacaoNome', 'xLocPrestacao', 'xLocIncid']) ??
        this.extractNestedAny(xml, ['locPrest'], ['xLocPrestacao']),
      valorServico:
        this.extract(xml, ['valorServico', 'ValorServicos', 'vServ']) ??
        this.extractNestedAny(xml, ['vServPrest'], ['vServ']),
      valorDeducoes: this.extract(xml, ['valorDeducoes', 'vDeducao', 'vDescCondIncond']),
      valorIss: this.extract(xml, ['valorIss', 'valorISS', 'vISSQN', 'vISS']),
      retencaoIss:
        this.extract(xml, ['tpRetISSQN', 'IssRetido']) ??
        this.extractNestedAny(xml, ['tribMun', 'Servico'], ['tpRetISSQN', 'IssRetido']),
      aliquotaIss: this.extract(xml, ['aliquotaIss', 'aliquotaISS', 'pAliqAplic', 'pAliq', 'pAliquota']),
      codigoServicoNacional: this.extract(xml, ['codigoServicoNacional', 'cTribNac']),
      itemListaServico: this.extract(xml, ['itemListaServico', 'ItemListaServico', 'cItemListaServ']),
      descricaoServico: this.extract(xml, ['descricaoServico', 'Discriminacao', 'xDescServ']),
      chaveSubstituida: this.normalizeChaveAcesso(this.extractNestedAny(xml, ['subst'], ['chSubstda'])),
      motivoSubstituicao: this.extractNestedAny(xml, ['subst'], ['xMotivo'])
    };
  }

  parseEvento(xml: string): ParsedNfseEvento {
    const chaveAcesso =
      this.normalizeChaveAcesso(this.extract(xml, ['chNFSe', 'chaveAcesso', 'ChaveAcesso'])) ??
      this.extractChaveAcesso(xml);

    if (!chaveAcesso) {
      throw new Error('Nao foi possivel localizar chave de acesso da NFS-e no XML de evento');
    }

    const tipoEvento = this.extractTipoEvento(xml) ?? 'evento';
    const descricao = this.extract(xml, ['xDesc', 'descricao', 'Descricao']);
    const motivo = this.extract(xml, ['xMotivo', 'motivo', 'Motivo']);
    const descricaoCompleta = [descricao, motivo].filter(Boolean).join(' - ') || undefined;

    return {
      chaveAcesso,
      tipoEvento,
      dataEvento: this.parseDate(this.extract(xml, ['dhEvento', 'dhProc', 'dataEvento'])),
      descricao: descricaoCompleta,
      cnpjAutor: this.normalizeCnpj(this.extract(xml, ['CNPJAutor', 'CnpjAutor', 'cnpjAutor'])),
      motivo,
      idEvento: this.extractAttribute(xml, 'infEvento', 'Id'),
      numeroSequencial: this.extract(xml, ['nSeqEvento']),
      isCancelamento: this.isCancelamentoEvento(tipoEvento, descricaoCompleta)
    };
  }

  isEventoXml(xml: string): boolean {
    return (
      /<(?:\w+:)?(?:evento|procEvento)\b/i.test(xml) &&
      (/<(?:\w+:)?infEvento\b/i.test(xml) ||
        /<(?:\w+:)?infPedReg\b/i.test(xml) ||
        /<(?:\w+:)?chNFSe\b/i.test(xml))
    );
  }

  private extractChaveAcesso(xml: string): string | undefined {
    const candidates: Array<string | undefined> = [
      this.extract(xml, ['chaveAcesso', 'ChaveAcesso']),
      this.extractAttribute(xml, 'infNFSe', 'Id'),
      this.extractAttribute(xml, 'infNfse', 'Id'),
      this.extractAttribute(xml, 'Reference', 'URI'),
      this.extractAttribute(xml, 'ref', 'uri')
    ];

    const normalizedCandidates = candidates
      .map((candidate) => this.normalizeChaveAcesso(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));

    const exactFromCandidates = normalizedCandidates.find((candidate) => /^\d{50}$/.test(candidate));
    if (exactFromCandidates) {
      return exactFromCandidates;
    }

    const fallbackMatches = xml.match(/(?:NFS)?\d{50}/gim);
    if (fallbackMatches?.length) {
      for (const raw of fallbackMatches) {
        const normalized = this.normalizeChaveAcesso(raw);
        if (normalized && /^\d{50}$/.test(normalized)) {
          return normalized;
        }
      }
    }

    if (normalizedCandidates.length) {
      const ranked = [...normalizedCandidates].sort((a, b) => {
        const aDigits = a.replace(/\D/g, '').length;
        const bDigits = b.replace(/\D/g, '').length;
        return bDigits - aDigits;
      });
      return ranked[0];
    }

    return undefined;
  }

  private extractTipoEvento(xml: string): string | undefined {
    const eventTag = xml.match(/<(?:\w+:)?(e\d{6})\b/i);
    if (eventTag?.[1]) {
      return eventTag[1].toLowerCase();
    }

    return this.extract(xml, ['tpEvento', 'tipoEvento', 'cEvento']);
  }

  private extractDpsId(xml: string): string | undefined {
    const candidate = this.extractAttribute(xml, 'infDPS', 'Id');
    return this.normalizeDpsId(candidate);
  }

  private extractNumeroDpsFromId(dpsId?: string): string | undefined {
    const normalized = this.normalizeDpsId(dpsId);
    if (!normalized || normalized.length < 15) {
      return undefined;
    }

    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 42) {
      return undefined;
    }

    const numero = digits.slice(-15).replace(/^0+/, '');
    return numero || '0';
  }

  private isCancelamentoEvento(tipoEvento?: string, descricao?: string): boolean {
    const tipo = this.normalizeSearchText(tipoEvento);
    const texto = this.normalizeSearchText(descricao);

    return (
      tipo === 'e101101' ||
      tipo.includes('cancelamento') ||
      tipo.includes('cancelada') ||
      texto.includes('cancelamento') ||
      texto.includes('cancelada')
    );
  }

  getHash(xml: string): string {
    return createHash('sha256').update(xml).digest('hex');
  }

  private extract(xml: string, tags: string[]): string | undefined {
    for (const tag of tags) {
      const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const match = regex.exec(xml);
      if (match?.[1]) {
        const value = this.cleanText(match[1]);
        if (value) {
          return value;
        }
      }
    }
    return undefined;
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
      const value = childMatch?.[1] ? this.cleanText(childMatch[1]) : undefined;
      if (value) {
        return value;
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

  private extractFromPath(xml: string, path: string[]): string | undefined {
    let current = xml;

    for (const tag of path) {
      const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const match = regex.exec(current);
      if (!match?.[1]) {
        return undefined;
      }

      current = match[1];
    }

    return this.cleanText(current);
  }

  private extractMunicipioTomador(xml: string): string | undefined {
    const codigoMunicipio =
      this.extractFromPaths(xml, [
        ['municipioTomadorCodigo'],
        ['infDPS', 'toma', 'end', 'endNac', 'cMun'],
        ['infDPS', 'toma', 'end', 'endNac', 'Municipio'],
        ['infDPS', 'toma', 'end', 'endNac', 'MunicipioNome'],
        ['infDPS', 'toma', 'end', 'endNac', 'xMunicipio'],
        ['tomador', 'end', 'endNac', 'cMun'],
        ['tomador', 'end', 'endNac', 'Municipio'],
        ['tomador', 'end', 'endNac', 'MunicipioNome'],
        ['tomador', 'end', 'endNac', 'xMunicipio'],
        ['TomadorServico', 'Endereco', 'CodigoMunicipio'],
        ['TomadorServico', 'Endereco', 'Municipio'],
        ['TomadorServico', 'Endereco', 'MunicipioNome'],
        ['TomadorServico', 'Endereco', 'xMunicipio'],
        ['Tomador', 'Endereco', 'CodigoMunicipio'],
        ['Tomador', 'Endereco', 'Municipio'],
        ['Tomador', 'Endereco', 'MunicipioNome'],
        ['Tomador', 'Endereco', 'xMunicipio'],
        ['tomador', 'Endereco', 'CodigoMunicipio'],
        ['tomador', 'Endereco', 'Municipio'],
        ['tomador', 'Endereco', 'MunicipioNome'],
        ['tomador', 'Endereco', 'xMunicipio'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'CodigoMunicipio']
      ]) ?? undefined;

    const municipioResolvido = resolveMunicipioIbge(codigoMunicipio);
    if (municipioResolvido) {
      return municipioResolvido;
    }

    const nomeMunicipio =
      this.extractFromPaths(xml, [
        ['municipioTomador'],
        ['infDPS', 'toma', 'end', 'endNac', 'xMun'],
        ['infDPS', 'toma', 'end', 'endNac', 'Municipio'],
        ['infDPS', 'toma', 'end', 'endNac', 'MunicipioNome'],
        ['infDPS', 'toma', 'end', 'endNac', 'xMunicipio'],
        ['tomador', 'end', 'endNac', 'xMun'],
        ['tomador', 'end', 'endNac', 'Municipio'],
        ['tomador', 'end', 'endNac', 'MunicipioNome'],
        ['tomador', 'end', 'endNac', 'xMunicipio'],
        ['TomadorServico', 'Endereco', 'Cidade'],
        ['TomadorServico', 'Endereco', 'xMun'],
        ['TomadorServico', 'Endereco', 'Municipio'],
        ['TomadorServico', 'Endereco', 'MunicipioNome'],
        ['TomadorServico', 'Endereco', 'xMunicipio'],
        ['Tomador', 'Endereco', 'Cidade'],
        ['Tomador', 'Endereco', 'xMun'],
        ['Tomador', 'Endereco', 'Municipio'],
        ['Tomador', 'Endereco', 'MunicipioNome'],
        ['Tomador', 'Endereco', 'xMunicipio'],
        ['tomador', 'Endereco', 'Cidade'],
        ['tomador', 'Endereco', 'xMun'],
        ['tomador', 'Endereco', 'Municipio'],
        ['tomador', 'Endereco', 'MunicipioNome'],
        ['tomador', 'Endereco', 'xMunicipio'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Cidade'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'xMun'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Municipio'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'MunicipioNome']
      ]) ?? undefined;
    if (!nomeMunicipio) {
      return undefined;
    }

    const ufMunicipio =
      this.extractFromPaths(xml, [
        ['infDPS', 'toma', 'end', 'endNac', 'UF'],
        ['tomador', 'end', 'endNac', 'UF'],
        ['TomadorServico', 'Endereco', 'Uf'],
        ['TomadorServico', 'Endereco', 'UF'],
        ['tomador', 'Endereco', 'Uf'],
        ['tomador', 'Endereco', 'UF'],
        ['Tomador', 'Endereco', 'Uf'],
        ['Tomador', 'Endereco', 'UF'],
        ['tomador', 'Endereco', 'Uf'],
        ['tomador', 'Endereco', 'UF'],
        ['DeclaracaoPrestacaoServico', 'InfDeclaracaoPrestacaoServico', 'Tomador', 'Endereco', 'Uf']
      ]) ?? undefined;

    const trimmedNome = nomeMunicipio.trim();
    const trimmedUf = ufMunicipio?.trim();
    if (!trimmedUf) {
      return trimmedNome;
    }

    if (trimmedNome.toUpperCase().endsWith(`/${trimmedUf.toUpperCase()}`)) {
      return trimmedNome;
    }

    return `${trimmedNome}/${trimmedUf}`;
  }

  private extractAttribute(xml: string, tag: string, attribute: string): string | undefined {
    const regex = new RegExp(
      `<(?:\\w+:)?${tag}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']+)["']`,
      'i'
    );
    const match = regex.exec(xml);
    return match?.[1]?.trim();
  }

  private cleanText(value: string): string {
    return this.decodeXmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
  }

  private normalizeSearchText(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private normalizeChaveAcesso(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const prefixed = trimmed.match(/NFS(\d{50})/i);
    if (prefixed?.[1]) {
      return prefixed[1];
    }

    const fiftyDigits = trimmed.match(/(\d{50})/);
    if (fiftyDigits?.[1]) {
      return fiftyDigits[1];
    }

    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 50) {
      return digits;
    }

    if (digits.length > 50) {
      return digits.slice(-50);
    }

    if (digits.length >= 20) {
      return digits;
    }

    return trimmed;
  }

  private normalizeDpsId(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim().toUpperCase();
    if (!trimmed) {
      return undefined;
    }

    const exact = trimmed.match(/DPS\d{42}/);
    if (exact?.[0]) {
      return exact[0];
    }

    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 42) {
      return `DPS${digits}`;
    }

    return trimmed.startsWith('DPS') ? trimmed : undefined;
  }

  private normalizeCnpj(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    if (!digits) {
      return undefined;
    }

    if (digits.length >= 14) {
      return digits.slice(-14);
    }

    return digits;
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

  private parseDateOnly(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const onlyDate = value.slice(0, 10);
    const [yearRaw, monthRaw, dayRaw] = onlyDate.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);

    if (!year || !month || !day) {
      return undefined;
    }

    return new Date(Date.UTC(year, month - 1, day));
  }
}
