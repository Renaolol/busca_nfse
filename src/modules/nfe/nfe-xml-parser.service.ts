import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface ParsedNfe {
  chaveAcesso: string;
  numeroNfe?: string;
  serie?: string;
  modelo?: string;
  dataEmissao?: Date;
  dataAutorizacao?: Date;
  status?: string;
  cnpjEmitente?: string;
  razaoSocialEmitente?: string;
  cnpjDestinatario?: string;
  razaoSocialDestinatario?: string;
  valorTotal?: string;
  schemaDoc: string;
  contentType: 'resumo' | 'completo';
}

export interface InspectedNfeXml {
  chaveAcesso?: string;
  numeroNfe?: string;
  serie?: string;
  modelo?: string;
}

export interface ClassifiedFiscalXml {
  documentType: 'nfe' | 'cte' | 'unknown';
  schemaDoc?: string;
  contentType?: 'resumo' | 'completo' | 'evento';
}

export interface ParsedDfeEvento {
  documentType: 'nfe' | 'cte';
  chaveAcesso: string;
  tipoEvento: string;
  dataEvento?: Date;
  descricao?: string;
  cnpjAutor?: string;
  idEvento?: string;
  numeroSequencial?: string;
  schemaDoc?: string;
  isCancelamento: boolean;
}

@Injectable()
export class NfeXmlParserService {
  inspect(xml: string): InspectedNfeXml {
    return {
      chaveAcesso: this.extractChaveAcesso(xml),
      numeroNfe: this.extract(xml, ['nNF']),
      serie: this.extract(xml, ['serie']),
      modelo: this.extract(xml, ['mod'])
    };
  }

  classify(xml: string): ClassifiedFiscalXml {
    if (this.isCteEventoXml(xml)) {
      return {
        documentType: 'cte',
        schemaDoc: this.detectCteEventSchemaDoc(xml),
        contentType: 'evento'
      };
    }

    if (this.isNfeEventoXml(xml)) {
      return {
        documentType: 'nfe',
        schemaDoc: this.detectNfeEventSchemaDoc(xml),
        contentType: 'evento'
      };
    }

    if (/<(?:\w+:)?resCTe\b/i.test(xml)) {
      return {
        documentType: 'cte',
        schemaDoc: 'resCTe_v1.00',
        contentType: 'resumo'
      };
    }

    if (/<(?:\w+:)?cteProc\b/i.test(xml) || /<(?:\w+:)?procCTe\b/i.test(xml)) {
      return {
        documentType: 'cte',
        schemaDoc: 'cteProc_v4.00',
        contentType: 'completo'
      };
    }

    if (/<(?:\w+:)?CTe\b/i.test(xml) || /portalfiscal\.inf\.br\/cte/i.test(xml)) {
      return {
        documentType: 'cte',
        schemaDoc: 'CTe_v4.00',
        contentType: 'completo'
      };
    }

    if (/<(?:\w+:)?resNFe\b/i.test(xml)) {
      return {
        documentType: 'nfe',
        schemaDoc: 'resNFe_v1.01',
        contentType: 'resumo'
      };
    }

    if (/<(?:\w+:)?nfeProc\b/i.test(xml) || /<(?:\w+:)?procNFe\b/i.test(xml)) {
      return {
        documentType: 'nfe',
        schemaDoc: 'procNFe_v4.00',
        contentType: 'completo'
      };
    }

    if (/<(?:\w+:)?NFe\b/i.test(xml) || /portalfiscal\.inf\.br\/nfe/i.test(xml)) {
      return {
        documentType: 'nfe',
        schemaDoc: 'NFe_v4.00',
        contentType: 'completo'
      };
    }

    return { documentType: 'unknown' };
  }

  parse(xml: string): ParsedNfe {
    const classification = this.classify(xml);
    if (classification.documentType === 'cte') {
      throw new Error('XML de CT-e informado no fluxo de NF-e');
    }
    if (classification.contentType === 'evento') {
      throw new Error('XML de evento informado no fluxo de NF-e');
    }

    const inspected = this.inspect(xml);
    const chaveAcesso = inspected.chaveAcesso;
    if (!chaveAcesso) {
      throw new Error('Nao foi possivel localizar chave de acesso no XML da NF-e');
    }

    const summary = classification.contentType === 'resumo';
    const schemaDoc = classification.schemaDoc ?? this.detectSchemaDoc(xml, summary);

    return {
      chaveAcesso,
      numeroNfe: inspected.numeroNfe,
      serie: inspected.serie,
      modelo: inspected.modelo,
      dataEmissao: this.parseDate(this.extract(xml, ['dhEmi', 'dEmi'])),
      dataAutorizacao: this.parseDate(this.extract(xml, ['dhRecbto', 'dhAut'])),
      status: this.extract(xml, ['cStat', 'cSitNFe', 'xMotivo']),
      cnpjEmitente:
        this.normalizeCnpj(this.extractNestedAny(xml, ['emit'], ['CNPJ', 'CPF'])) ??
        this.normalizeCnpj(summary ? this.extract(xml, ['CNPJ']) : undefined),
      razaoSocialEmitente:
        this.extractNestedAny(xml, ['emit'], ['xNome']) ?? (summary ? this.extract(xml, ['xNome']) : undefined),
      cnpjDestinatario: this.normalizeCnpj(this.extractNestedAny(xml, ['dest'], ['CNPJ', 'CPF'])),
      razaoSocialDestinatario: this.extractNestedAny(xml, ['dest'], ['xNome']),
      valorTotal:
        this.extractNestedAny(xml, ['ICMSTot'], ['vNF']) ??
        this.extractNestedAny(xml, ['total'], ['vNF']) ??
        this.extract(xml, ['vNF']),
      schemaDoc,
      contentType: summary ? 'resumo' : 'completo'
    };
  }

  getHash(xml: string): string {
    return createHash('sha256').update(xml).digest('hex');
  }

  parseEvento(xml: string): ParsedDfeEvento {
    const classification = this.classify(xml);
    if (classification.contentType !== 'evento' || classification.documentType === 'unknown') {
      throw new Error('XML informado nao corresponde a um evento de NF-e/CT-e');
    }

    const chaveAcesso = this.extractEventAccessKey(xml);
    if (!chaveAcesso) {
      throw new Error('Nao foi possivel localizar chave de acesso no XML do evento');
    }

    const tipoEvento = this.extract(xml, ['tpEvento', 'cEvento']) ?? 'evento';
    const descricao =
      this.extract(xml, ['xEvento', 'descEvento', 'xJust']) ??
      this.extractEventoDescricaoPorTag(xml, tipoEvento);

    return {
      documentType: classification.documentType,
      chaveAcesso,
      tipoEvento,
      dataEvento: this.parseDate(this.extract(xml, ['dhEvento', 'dhRegEvento', 'dhProc'])),
      descricao,
      cnpjAutor: this.normalizeCnpj(this.extract(xml, ['CNPJ', 'CPF'])),
      idEvento: this.extractAttribute(xml, 'infEvento', 'Id'),
      numeroSequencial: this.extract(xml, ['nSeqEvento']),
      schemaDoc: classification.schemaDoc,
      isCancelamento: this.isCancelamentoEvento(tipoEvento, descricao)
    };
  }

  isEventoXml(xml: string): boolean {
    return this.classify(xml).contentType === 'evento';
  }

  private isSummaryXml(xml: string): boolean {
    return /<(?:\w+:)?resNFe\b/i.test(xml);
  }

  private detectSchemaDoc(xml: string, summary: boolean): string {
    if (summary) {
      return 'resNFe_v1.01';
    }
    if (/<(?:\w+:)?nfeProc\b/i.test(xml)) {
      return 'procNFe_v4.00';
    }
    if (/<(?:\w+:)?procNFe\b/i.test(xml)) {
      return 'procNFe_v4.00';
    }
    return 'NFe_v4.00';
  }

  private detectNfeEventSchemaDoc(xml: string): string {
    if (/<(?:\w+:)?procEventoNFe\b/i.test(xml) || /<(?:\w+:)?procEvento\b/i.test(xml)) {
      return 'procEventoNFe_v1.00';
    }
    return 'eventoNFe_v1.00';
  }

  private detectCteEventSchemaDoc(xml: string): string {
    if (/<(?:\w+:)?procEventoCTe\b/i.test(xml) || /<(?:\w+:)?procEventoCTeOS\b/i.test(xml)) {
      return 'procEventoCTe_v4.00';
    }
    return 'eventoCTe_v4.00';
  }

  private isNfeEventoXml(xml: string): boolean {
    return (
      /portalfiscal\.inf\.br\/nfe/i.test(xml) &&
      (/<(?:\w+:)?procEventoNFe\b/i.test(xml) ||
        /<(?:\w+:)?procEvento\b/i.test(xml) ||
        /<(?:\w+:)?evento\b/i.test(xml) ||
        /<(?:\w+:)?retEvento\b/i.test(xml)) &&
      /<(?:\w+:)?infEvento\b/i.test(xml)
    );
  }

  private isCteEventoXml(xml: string): boolean {
    return (
      /portalfiscal\.inf\.br\/cte/i.test(xml) &&
      (/<(?:\w+:)?procEventoCTe\b/i.test(xml) ||
        /<(?:\w+:)?procEventoCTeOS\b/i.test(xml) ||
        /<(?:\w+:)?eventoCTe\b/i.test(xml) ||
        /<(?:\w+:)?eventoCTeOS\b/i.test(xml) ||
        /<(?:\w+:)?procEvento\b/i.test(xml) ||
        /<(?:\w+:)?evento\b/i.test(xml)) &&
      /<(?:\w+:)?infEvento\b/i.test(xml)
    );
  }

  private extractChaveAcesso(xml: string): string | undefined {
    const direct = this.normalizeChaveAcesso(this.extract(xml, ['chNFe']));
    if (direct) {
      return direct;
    }

    const id = this.extractAttribute(xml, 'infNFe', 'Id');
    const normalizedId = this.normalizeChaveAcesso(id);
    if (normalizedId) {
      return normalizedId;
    }

    const fromText = xml.match(/\b\d{44}\b/);
    return fromText?.[0];
  }

  private extractEventAccessKey(xml: string): string | undefined {
    const direct = this.normalizeChaveAcesso(this.extract(xml, ['chNFe', 'chCTe']));
    if (direct) {
      return direct;
    }

    const infEventoId = this.extractAttribute(xml, 'infEvento', 'Id');
    const idDigits = infEventoId?.match(/(\d{44})/)?.[1];
    if (idDigits) {
      return idDigits;
    }

    const generic = xml.match(/\b\d{44}\b/);
    return generic?.[0];
  }

  private extractEventoDescricaoPorTag(xml: string, tipoEvento: string): string | undefined {
    const normalized = tipoEvento.trim();
    if (!normalized) {
      return undefined;
    }

    const byTipo = this.extractNestedAny(xml, [normalized], ['xDesc', 'descEvento', 'xEvento', 'xJust']);
    if (byTipo) {
      return byTipo;
    }

    return undefined;
  }

  private extract(xml: string, tags: string[]): string | undefined {
    for (const tag of tags) {
      const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i');
      const match = regex.exec(xml);
      if (match?.[1]) {
        const cleaned = this.cleanText(match[1]);
        if (cleaned) {
          return cleaned;
        }
      }
    }

    return undefined;
  }

  private extractNestedAny(xml: string, parentTags: string[], childTags: string[]): string | undefined {
    for (const parentTag of parentTags) {
      const parentRegex = new RegExp(
        `<(?:\\w+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${parentTag}>`,
        'i'
      );
      const parentMatch = parentRegex.exec(xml);
      if (!parentMatch?.[1]) {
        continue;
      }

      for (const childTag of childTags) {
        const childRegex = new RegExp(
          `<(?:\\w+:)?${childTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${childTag}>`,
          'i'
        );
        const childMatch = childRegex.exec(parentMatch[1]);
        if (childMatch?.[1]) {
          const cleaned = this.cleanText(childMatch[1]);
          if (cleaned) {
            return cleaned;
          }
        }
      }
    }

    return undefined;
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
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
  }

  private normalizeChaveAcesso(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits.length === 44 ? digits : undefined;
  }

  private normalizeCnpj(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits || undefined;
  }

  private isCancelamentoEvento(tipoEvento?: string, descricao?: string): boolean {
    const tipo = this.normalizeSearchText(tipoEvento);
    const desc = this.normalizeSearchText(descricao);

    return (
      tipo === '110111' ||
      tipo.includes('cancel') ||
      desc.includes('cancelamento') ||
      desc.includes('cancelada')
    );
  }

  private normalizeSearchText(value?: string): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
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
}
