import { BadRequestException, Injectable } from '@nestjs/common';
import JSZip from 'jszip';

export interface PlanilhaSimplesEmpresa {
  cnpjBase: string;
  cnpj: string | null;
  razaoSocial: string | null;
  linha: number;
}

export interface PlanilhaSimplesLinhaIgnorada {
  linha: number;
  valor: string;
  motivo: string;
}

export interface PlanilhaSimplesResultado {
  empresas: PlanilhaSimplesEmpresa[];
  ignoradas: PlanilhaSimplesLinhaIgnorada[];
  totalLinhas: number;
  totalDuplicadas: number;
  colunaCnpj: string;
  colunaRazaoSocial: string | null;
}

interface PlanilhaLinha {
  linha: number;
  celulas: string[];
}

interface ColunasDetectadas {
  indiceCabecalho: number;
  cnpj: number;
  razaoSocial: number | null;
  rotuloCnpj: string;
  rotuloRazaoSocial: string | null;
}

type CnpjNormalizado = { cnpjBase: string; cnpj: string | null };

const MAX_LINHAS = 200000;
const LINHAS_BUSCA_CABECALHO = 30;
const LINHAS_AMOSTRA_CONTEUDO = 200;
const TAMANHO_MAXIMO_CABECALHO = 30;
const CHAVES_RAZAO_SOCIAL = [
  'razaosocial',
  'nomeempresarial',
  'nomedaempresa',
  'nomeempresa',
  'empresa',
  'contribuinte',
  'cliente',
  'nome'
];

@Injectable()
export class SimplesNacionalPlanilhaParserService {
  async parse(nomeArquivo: string, conteudo: Buffer): Promise<PlanilhaSimplesResultado> {
    if (!conteudo.length) {
      throw new BadRequestException('O arquivo enviado esta vazio.');
    }

    const planilhas = await this.lerPlanilhas(nomeArquivo, conteudo);
    for (const linhas of planilhas) {
      if (linhas.length > MAX_LINHAS) {
        throw new BadRequestException(`A planilha excede o limite de ${MAX_LINHAS} linhas.`);
      }

      const colunas = this.detectarColunas(linhas);
      if (colunas) {
        return this.extrairEmpresas(linhas, colunas);
      }
    }

    throw new BadRequestException(
      'Nao foi encontrada uma coluna de CNPJ na planilha. Inclua um cabecalho "CNPJ" na coluna com os CNPJs das empresas.'
    );
  }

  normalizarCnpj(valor: string): CnpjNormalizado | null {
    const texto = String(valor || '')
      .trim()
      .toUpperCase()
      .replace(/[\s./-]/g, '');

    if (/^\d{8}$/.test(texto)) {
      return /^0{8}$/.test(texto) ? null : { cnpjBase: texto, cnpj: null };
    }

    const cnpj = /^\d{12,13}$/.test(texto) ? texto.padStart(14, '0') : texto;
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj) || !this.digitosVerificadoresValidos(cnpj)) {
      return null;
    }

    return { cnpjBase: cnpj.slice(0, 8), cnpj };
  }

  private digitosVerificadoresValidos(cnpj: string): boolean {
    const calcular = (base: string): number => {
      let peso = 2;
      let soma = 0;
      for (let indice = base.length - 1; indice >= 0; indice -= 1) {
        soma += (base.charCodeAt(indice) - 48) * peso;
        peso = peso === 9 ? 2 : peso + 1;
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };

    const primeiro = calcular(cnpj.slice(0, 12));
    const segundo = calcular(cnpj.slice(0, 12) + String(primeiro));
    return cnpj.slice(12) === `${primeiro}${segundo}`;
  }

  private extrairEmpresas(linhas: PlanilhaLinha[], colunas: ColunasDetectadas): PlanilhaSimplesResultado {
    const empresasPorBase = new Map<string, PlanilhaSimplesEmpresa>();
    const ignoradas: PlanilhaSimplesLinhaIgnorada[] = [];
    let totalLinhas = 0;
    let totalDuplicadas = 0;

    for (const { linha, celulas } of linhas.slice(colunas.indiceCabecalho + 1)) {
      if (celulas.every((celula) => !celula.trim())) {
        continue;
      }

      totalLinhas += 1;
      const valorCnpj = (celulas[colunas.cnpj] ?? '').trim();
      if (!valorCnpj) {
        ignoradas.push({ linha, valor: '', motivo: 'CNPJ nao informado' });
        continue;
      }

      const normalizado = this.normalizarCnpj(valorCnpj);
      if (!normalizado) {
        ignoradas.push({ linha, valor: valorCnpj.slice(0, 60), motivo: 'CNPJ invalido' });
        continue;
      }

      const razaoSocial =
        colunas.razaoSocial === null ? null : this.normalizarTexto(celulas[colunas.razaoSocial], 255);
      const existente = empresasPorBase.get(normalizado.cnpjBase);
      if (!existente) {
        empresasPorBase.set(normalizado.cnpjBase, { ...normalizado, razaoSocial, linha });
        continue;
      }

      totalDuplicadas += 1;
      existente.razaoSocial = existente.razaoSocial ?? razaoSocial;
      const substituirPorMatriz =
        Boolean(existente.cnpj) && this.isMatriz(normalizado.cnpj ?? '') && !this.isMatriz(existente.cnpj ?? '');
      if (normalizado.cnpj && (!existente.cnpj || substituirPorMatriz)) {
        existente.cnpj = normalizado.cnpj;
      }
    }

    return {
      empresas: [...empresasPorBase.values()],
      ignoradas,
      totalLinhas,
      totalDuplicadas,
      colunaCnpj: colunas.rotuloCnpj,
      colunaRazaoSocial: colunas.rotuloRazaoSocial
    };
  }

  private isMatriz(cnpj: string): boolean {
    return cnpj.slice(8, 12) === '0001';
  }

  private detectarColunas(linhas: PlanilhaLinha[]): ColunasDetectadas | null {
    for (const [indice, { celulas }] of linhas.slice(0, LINHAS_BUSCA_CABECALHO).entries()) {
      const cabecalhos = celulas.map((celula) => this.normalizarCabecalho(celula));
      const cnpj = cabecalhos.findIndex(
        (cabecalho) => cabecalho.includes('cnpj') && cabecalho.length <= TAMANHO_MAXIMO_CABECALHO
      );
      if (cnpj < 0) {
        continue;
      }

      const razaoSocial = this.encontrarColunaRazaoSocial(cabecalhos, cnpj);
      return {
        indiceCabecalho: indice,
        cnpj,
        razaoSocial,
        rotuloCnpj: celulas[cnpj].trim(),
        rotuloRazaoSocial: razaoSocial === null ? null : celulas[razaoSocial].trim()
      };
    }

    return this.detectarColunasPeloConteudo(linhas);
  }

  private encontrarColunaRazaoSocial(cabecalhos: string[], colunaCnpj: number): number | null {
    for (const chave of CHAVES_RAZAO_SOCIAL) {
      const indice = cabecalhos.findIndex(
        (cabecalho, posicao) => posicao !== colunaCnpj && cabecalho.includes(chave) && !cabecalho.includes('fantasia')
      );
      if (indice >= 0) {
        return indice;
      }
    }

    return null;
  }

  private detectarColunasPeloConteudo(linhas: PlanilhaLinha[]): ColunasDetectadas | null {
    const amostra = linhas.slice(0, LINHAS_AMOSTRA_CONTEUDO);
    const cnpjsPorColuna = new Map<number, number>();
    const textosPorColuna = new Map<number, number>();

    for (const { celulas } of amostra) {
      celulas.forEach((celula, indice) => {
        if (this.normalizarCnpj(celula)) {
          cnpjsPorColuna.set(indice, (cnpjsPorColuna.get(indice) ?? 0) + 1);
        } else if (/[A-Za-zÀ-ÿ]{3,}/.test(celula)) {
          textosPorColuna.set(indice, (textosPorColuna.get(indice) ?? 0) + 1);
        }
      });
    }

    const cnpj = this.colunaComMaiorContagem(cnpjsPorColuna);
    if (cnpj === null) {
      return null;
    }

    textosPorColuna.delete(cnpj);
    const razaoSocial = this.colunaComMaiorContagem(textosPorColuna);
    return {
      indiceCabecalho: -1,
      cnpj,
      razaoSocial,
      rotuloCnpj: `Coluna ${this.letraColuna(cnpj)}`,
      rotuloRazaoSocial: razaoSocial === null ? null : `Coluna ${this.letraColuna(razaoSocial)}`
    };
  }

  private colunaComMaiorContagem(contagens: Map<number, number>): number | null {
    let melhor: number | null = null;
    for (const [indice, total] of contagens) {
      if (melhor === null || total > (contagens.get(melhor) ?? 0)) {
        melhor = indice;
      }
    }

    return melhor;
  }

  private letraColuna(indice: number): string {
    let letra = '';
    let restante = indice + 1;
    while (restante > 0) {
      const resto = (restante - 1) % 26;
      letra = String.fromCharCode(65 + resto) + letra;
      restante = Math.floor((restante - 1) / 26);
    }

    return letra;
  }

  private async lerPlanilhas(nomeArquivo: string, conteudo: Buffer): Promise<PlanilhaLinha[][]> {
    if (conteudo[0] === 0x50 && conteudo[1] === 0x4b) {
      return this.lerXlsx(conteudo);
    }

    if (conteudo[0] === 0xd0 && conteudo[1] === 0xcf) {
      throw new BadRequestException(
        `Formato .xls (Excel 97-2003) nao suportado em "${nomeArquivo}". Salve a planilha como .xlsx ou .csv e envie novamente.`
      );
    }

    return [this.lerCsv(this.decodificarTexto(conteudo))];
  }

  private decodificarTexto(conteudo: Buffer): string {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(conteudo);
    } catch {
      return new TextDecoder('windows-1252').decode(conteudo);
    }
  }

  private lerCsv(texto: string): PlanilhaLinha[] {
    const primeiraLinha = texto.split(/\r?\n/).find((linha) => linha.trim()) ?? '';
    const separador = this.detectarSeparador(primeiraLinha);
    const linhas: PlanilhaLinha[] = [];
    let celulas: string[] = [];
    let celula = '';
    let entreAspas = false;
    let numeroLinha = 1;
    let inicioLinha = 1;

    const fecharLinha = () => {
      celulas.push(celula);
      linhas.push({ linha: inicioLinha, celulas });
      celulas = [];
      celula = '';
      inicioLinha = numeroLinha;
    };

    for (let indice = 0; indice < texto.length; indice += 1) {
      const caractere = texto[indice];

      if (entreAspas) {
        if (caractere === '"' && texto[indice + 1] === '"') {
          celula += '"';
          indice += 1;
        } else if (caractere === '"') {
          entreAspas = false;
        } else {
          if (caractere === '\n') {
            numeroLinha += 1;
          }
          celula += caractere;
        }
        continue;
      }

      if (caractere === '"' && !celula.trim()) {
        entreAspas = true;
        celula = '';
      } else if (caractere === separador) {
        celulas.push(celula);
        celula = '';
      } else if (caractere === '\n') {
        numeroLinha += 1;
        fecharLinha();
      } else if (caractere !== '\r') {
        celula += caractere;
      }
    }

    if (celula || celulas.length) {
      fecharLinha();
    }

    return linhas;
  }

  private detectarSeparador(linha: string): string {
    const candidatos = [';', ',', '\t', '|'];
    let melhor = ';';
    let melhorContagem = 0;
    for (const candidato of candidatos) {
      const contagem = linha.split(candidato).length - 1;
      if (contagem > melhorContagem) {
        melhor = candidato;
        melhorContagem = contagem;
      }
    }

    return melhor;
  }

  private async lerXlsx(conteudo: Buffer): Promise<PlanilhaLinha[][]> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(conteudo);
    } catch {
      throw new BadRequestException('Nao foi possivel abrir a planilha. Envie um arquivo .xlsx ou .csv valido.');
    }

    const workbook = await zip.file('xl/workbook.xml')?.async('string');
    if (!workbook) {
      throw new BadRequestException('O arquivo nao e uma planilha .xlsx valida. Envie um arquivo .xlsx ou .csv.');
    }

    const textosCompartilhados = this.lerTextosCompartilhados(await zip.file('xl/sharedStrings.xml')?.async('string'));
    const caminhos = await this.resolverCaminhosPlanilhas(zip, workbook);
    const planilhas: PlanilhaLinha[][] = [];
    for (const caminho of caminhos) {
      const xml = await zip.file(caminho)?.async('string');
      if (xml) {
        planilhas.push(this.lerLinhasXlsx(xml, textosCompartilhados));
      }
    }

    return planilhas;
  }

  private async resolverCaminhosPlanilhas(zip: JSZip, workbook: string): Promise<string[]> {
    const relacionamentos = new Map<string, string>();
    const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
    for (const [tag] of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
      const id = this.lerAtributo(tag, 'Id');
      const destino = this.lerAtributo(tag, 'Target');
      if (id && destino) {
        relacionamentos.set(id, destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`);
      }
    }

    const caminhos: string[] = [];
    for (const [tag] of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
      const idRelacionamento = tag.match(/\s(?:\w+:)id="([^"]+)"/)?.[1];
      const caminho = idRelacionamento ? relacionamentos.get(idRelacionamento) : undefined;
      if (caminho) {
        caminhos.push(caminho);
      }
    }

    if (caminhos.length) {
      return caminhos;
    }

    return Object.keys(zip.files)
      .filter((nome) => /^xl\/worksheets\/sheet\d+\.xml$/.test(nome))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  }

  private lerTextosCompartilhados(xml?: string): string[] {
    if (!xml) {
      return [];
    }

    return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(([, conteudo]) =>
      this.lerTextos(conteudo.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, ''))
    );
  }

  private lerLinhasXlsx(xml: string, textosCompartilhados: string[]): PlanilhaLinha[] {
    const linhas: PlanilhaLinha[] = [];
    const regexLinha = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
    const regexCelula = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;

    for (const [, atributosLinha, conteudoLinha] of xml.matchAll(regexLinha)) {
      const numeroLinha = Number(this.lerAtributo(atributosLinha, 'r')) || linhas.length + 1;
      const celulas: string[] = [];

      for (const [, atributosCelula, conteudoCelula = ''] of (conteudoLinha ?? '').matchAll(regexCelula)) {
        const referencia = this.lerAtributo(atributosCelula, 'r');
        const indice = referencia ? this.indiceColuna(referencia) : celulas.length;
        celulas[indice] = this.lerValorCelula(this.lerAtributo(atributosCelula, 't'), conteudoCelula, textosCompartilhados);
      }

      linhas.push({ linha: numeroLinha, celulas: Array.from(celulas, (celula) => celula ?? '') });
    }

    return linhas;
  }

  private lerValorCelula(tipo: string | null, conteudo: string, textosCompartilhados: string[]): string {
    if (tipo === 'inlineStr') {
      return this.lerTextos(conteudo);
    }

    const valor = this.decodificarXml(conteudo.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? '');
    if (tipo === 's') {
      return textosCompartilhados[Number(valor)] ?? '';
    }

    if (tipo === 'str' || tipo === 'e') {
      return valor;
    }

    if (tipo === 'b') {
      return valor === '1' ? 'TRUE' : 'FALSE';
    }

    if (/^-?\d+(\.\d+)?E[+-]?\d+$/i.test(valor)) {
      const numero = Number(valor);
      return Number.isInteger(numero) ? numero.toFixed(0) : valor;
    }

    return valor;
  }

  private lerTextos(conteudo: string): string {
    return [...conteudo.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
      .map(([, texto]) => this.decodificarXml(texto))
      .join('');
  }

  private indiceColuna(referencia: string): number {
    const letras = referencia.replace(/[^A-Z]/gi, '').toUpperCase();
    let indice = 0;
    for (const letra of letras) {
      indice = indice * 26 + (letra.charCodeAt(0) - 64);
    }

    return Math.max(0, indice - 1);
  }

  private lerAtributo(tag: string, nome: string): string | null {
    return tag.match(new RegExp(`\\s${nome}="([^"]*)"`))?.[1] ?? null;
  }

  private decodificarXml(texto: string): string {
    return texto
      .replace(/_x([0-9A-F]{4})_/gi, (_, codigo: string) => this.caractereDoCodigo(parseInt(codigo, 16)))
      .replace(/&#x([0-9a-f]+);/gi, (_, codigo: string) => this.caractereDoCodigo(parseInt(codigo, 16)))
      .replace(/&#(\d+);/g, (_, codigo: string) => this.caractereDoCodigo(Number(codigo)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  private caractereDoCodigo(codigo: number): string {
    return Number.isInteger(codigo) && codigo >= 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '';
  }

  private normalizarCabecalho(valor: string): string {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizarTexto(valor: string | undefined, tamanhoMaximo: number): string | null {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    return texto ? texto.slice(0, tamanhoMaximo) : null;
  }
}
