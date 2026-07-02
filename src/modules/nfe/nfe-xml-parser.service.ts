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

  parse(xml: string): ParsedNfe {
    const inspected = this.inspect(xml);
    const chaveAcesso = inspected.chaveAcesso;
    if (!chaveAcesso) {
      throw new Error('Nao foi possivel localizar chave de acesso no XML da NF-e');
    }

    const summary = this.isSummaryXml(xml);
    const schemaDoc = this.detectSchemaDoc(xml, summary);

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
