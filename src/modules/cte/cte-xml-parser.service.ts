import { Injectable } from '@nestjs/common';

export interface ParsedCte {
  chaveAcesso?: string;
  numeroCte?: string;
  serie?: string;
  modelo?: string;
  dataEmissao?: Date;
  dataAutorizacao?: Date;
  valorTotal?: string;
  status?: string;
  cnpjEmitente?: string;
  razaoSocialEmitente?: string;
  cnpjDestinatario?: string;
  razaoSocialDestinatario?: string;
  cnpjTomador?: string;
  razaoSocialTomador?: string;
  schemaDoc?: string;
}

@Injectable()
export class CteXmlParserService {
  parse(xml: string): ParsedCte {
    return {
      chaveAcesso: this.extractChaveAcesso(xml),
      numeroCte: this.extract(xml, ['nCT']),
      serie: this.extract(xml, ['serie']),
      modelo: this.extract(xml, ['mod']),
      dataEmissao: this.parseDate(this.extract(xml, ['dhEmi', 'dEmi'])),
      dataAutorizacao: this.parseDate(this.extract(xml, ['dhRecbto', 'dhAut'])),
      valorTotal: this.extractNestedAny(xml, ['vPrest'], ['vTPrest', 'vRec']) ?? this.extract(xml, ['vTPrest', 'vRec']),
      status: this.extract(xml, ['xMotivo']),
      cnpjEmitente: this.extractNestedAny(xml, ['emit'], ['CNPJ', 'CPF']) ?? this.extract(xml, ['CNPJCPF']),
      razaoSocialEmitente: this.extractNestedAny(xml, ['emit'], ['xNome']),
      cnpjDestinatario:
        this.extractNestedAny(xml, ['dest', 'rem', 'receb'], ['CNPJ', 'CPF']) ??
        this.extract(xml, ['CNPJDest', 'CNPJRem']),
      razaoSocialDestinatario:
        this.extractNestedAny(xml, ['dest', 'rem', 'receb'], ['xNome']) ??
        this.extract(xml, ['xNomeDest', 'xNomeRem']),
      cnpjTomador: this.extractNestedAny(xml, ['toma4'], ['CNPJ', 'CPF']),
      razaoSocialTomador: this.extractNestedAny(xml, ['toma4'], ['xNome']),
      schemaDoc: this.detectSchemaDoc(xml)
    };
  }

  private detectSchemaDoc(xml: string): string | undefined {
    if (/<(?:\w+:)?retConsSitCTe\b/i.test(xml)) {
      return 'retConsSitCTe_v4.00';
    }

    if (/<(?:\w+:)?resCTe\b/i.test(xml)) {
      return 'resCTe_v1.00';
    }

    if (/<(?:\w+:)?cteProc\b/i.test(xml) || /<(?:\w+:)?procCTe\b/i.test(xml)) {
      return 'cteProc_v4.00';
    }

    if (/<(?:\w+:)?CTe\b/i.test(xml) || /portalfiscal\.inf\.br\/cte/i.test(xml)) {
      return 'CTe_v4.00';
    }

    return undefined;
  }

  private extractChaveAcesso(xml: string): string | undefined {
    const id = this.extractAttribute(xml, 'infCte', 'Id');
    const normalizedId = this.normalizeAccessKey(id);
    if (normalizedId) {
      return normalizedId;
    }

    const direct = this.normalizeAccessKey(this.extract(xml, ['chCTe']));
    if (direct) {
      return direct;
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
    const regex = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i');
    const match = regex.exec(xml);
    return match?.[1]?.trim();
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private normalizeAccessKey(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = value.replace(/\D/g, '');
    return digits.length === 44 ? digits : undefined;
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
}
