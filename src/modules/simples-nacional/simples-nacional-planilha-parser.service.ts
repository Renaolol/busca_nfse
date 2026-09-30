import { BadRequestException, Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { createGunzip, createInflateRaw } from 'node:zlib';
import JSZip from 'jszip';

export type PlanilhaSimplesLayout = 'planilha' | 'receita_simples';

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

export interface PlanilhaSimplesOpcoes {
  tamanhoLote: number;
  onLote: (empresas: PlanilhaSimplesEmpresa[]) => Promise<void>;
  onProgresso?: (linhasLidas: number) => void;
}

export interface PlanilhaSimplesResumo {
  layout: PlanilhaSimplesLayout;
  colunaCnpj: string;
  colunaRazaoSocial: string | null;
  colunaOpcao: string | null;
  totalLinhas: number;
  totalOptantes: number;
  totalNaoOptantes: number;
  totalIgnoradas: number;
  linhasIgnoradas: PlanilhaSimplesLinhaIgnorada[];
}

interface PlanilhaLinha {
  linha: number;
  celulas: string[];
}

interface ColunasDetectadas {
  layout: PlanilhaSimplesLayout;
  linhaCabecalho: number;
  cnpj: number;
  razaoSocial: number | null;
  opcao: number | null;
  rotuloCnpj: string;
  rotuloRazaoSocial: string | null;
  rotuloOpcao: string | null;
}

interface EntradaZip {
  nome: string;
  metodo: number;
  criptografada: boolean;
  tamanhoComprimido: number;
  offsetCabecalhoLocal: number;
}

type FonteLinhas = () => AsyncIterable<PlanilhaLinha[]>;
type CnpjNormalizado = { cnpjBase: string; cnpj: string | null };

const MAX_BYTES_XLSX = 100 * 1024 * 1024;
const MAX_BYTES_DIRETORIO_ZIP = 50 * 1024 * 1024;
const MAX_LINHAS_IGNORADAS = 50;
const LINHAS_BUSCA_CABECALHO = 30;
const LINHAS_AMOSTRA_CONTEUDO = 200;
const TAMANHO_MAXIMO_CABECALHO = 30;
const PROPORCAO_MINIMA_LAYOUT_RECEITA = 0.9;
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
const VALORES_OPTANTE = new Set(['s', 'sim', 'x', '1', 'true', 'verdadeiro', 'y', 'yes', 'optante', 'mei']);
const ROTULO_CNPJ_RECEITA = 'CNPJ basico (arquivo Simples da Receita Federal)';
const ROTULO_OPCAO_RECEITA = 'Opcao pelo Simples (S/N)';

@Injectable()
export class SimplesNacionalPlanilhaParserService {
  /**
   * Le o arquivo em streaming e entrega as empresas optantes em lotes. Aceita .csv/.txt, .zip com CSV
   * (ex.: arquivo Simples dos dados abertos do CNPJ) e .xlsx.
   */
  async processarArquivo(
    caminho: string,
    nomeArquivo: string,
    opcoes: PlanilhaSimplesOpcoes
  ): Promise<PlanilhaSimplesResumo> {
    const fontes = await this.abrirFontes(caminho, nomeArquivo);
    for (const fonte of fontes) {
      const resumo = await this.processarFonte(fonte, opcoes);
      if (resumo) {
        return resumo;
      }
    }

    throw new BadRequestException(
      'Nao foi encontrada uma coluna de CNPJ na planilha. Inclua um cabecalho "CNPJ" na coluna com os CNPJs das empresas.'
    );
  }

  normalizarCnpj(valor: string, aceitarRaizAlfanumerica = false): CnpjNormalizado | null {
    const texto = String(valor || '')
      .trim()
      .toUpperCase()
      .replace(/[\s./-]/g, '');

    const raizValida = aceitarRaizAlfanumerica ? /^[0-9A-Z]{8}$/ : /^\d{8}$/;
    if (raizValida.test(texto)) {
      return /^0{8}$/.test(texto) ? null : { cnpjBase: texto, cnpj: null };
    }

    const cnpj = /^\d{12,13}$/.test(texto) ? texto.padStart(14, '0') : texto;
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj) || !this.digitosVerificadoresValidos(cnpj)) {
      return null;
    }

    return { cnpjBase: cnpj.slice(0, 8), cnpj };
  }

  private async processarFonte(fonte: FonteLinhas, opcoes: PlanilhaSimplesOpcoes): Promise<PlanilhaSimplesResumo | null> {
    const iterador = fonte()[Symbol.asyncIterator]();
    try {
      const amostra: PlanilhaLinha[] = [];
      let esgotada = false;
      while (amostra.length < LINHAS_AMOSTRA_CONTEUDO) {
        const { value, done } = await iterador.next();
        if (done) {
          esgotada = true;
          break;
        }
        amostra.push(...value);
      }

      const colunas = this.detectarColunas(amostra);
      if (!colunas) {
        return null;
      }

      const extrator = new ExtratorEmpresas(this, colunas, opcoes);
      await extrator.processar(amostra);
      while (!esgotada) {
        const { value, done } = await iterador.next();
        if (done) {
          break;
        }
        await extrator.processar(value);
      }

      return extrator.finalizar();
    } finally {
      await iterador.return?.();
    }
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

  private detectarColunas(linhas: PlanilhaLinha[]): ColunasDetectadas | null {
    for (const { linha, celulas } of linhas.slice(0, LINHAS_BUSCA_CABECALHO)) {
      const cabecalhos = celulas.map((celula) => this.normalizarCabecalho(celula));
      const cnpj = cabecalhos.findIndex(
        (cabecalho) => cabecalho.includes('cnpj') && cabecalho.length <= TAMANHO_MAXIMO_CABECALHO
      );
      if (cnpj < 0) {
        continue;
      }

      const razaoSocial = this.encontrarColunaRazaoSocial(cabecalhos, cnpj);
      const opcao = this.encontrarColunaOpcao(cabecalhos, [cnpj, razaoSocial]);
      return {
        layout: 'planilha',
        linhaCabecalho: linha,
        cnpj,
        razaoSocial,
        opcao,
        rotuloCnpj: celulas[cnpj].trim(),
        rotuloRazaoSocial: razaoSocial === null ? null : celulas[razaoSocial].trim(),
        rotuloOpcao: opcao === null ? null : celulas[opcao].trim()
      };
    }

    return this.detectarLayoutReceita(linhas) ?? this.detectarColunasPeloConteudo(linhas);
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

  private encontrarColunaOpcao(cabecalhos: string[], ocupadas: Array<number | null>): number | null {
    const indice = cabecalhos.findIndex(
      (cabecalho, posicao) =>
        !ocupadas.includes(posicao) &&
        /simples|optante|opcao|regime|tributacao/.test(cabecalho) &&
        !/data|mei|cnpj/.test(cabecalho)
    );
    return indice >= 0 ? indice : null;
  }

  /** Arquivo Simples dos dados abertos do CNPJ: sem cabecalho; CNPJ basico; opcao S/N; datas AAAAMMDD. */
  private detectarLayoutReceita(linhas: PlanilhaLinha[]): ColunasDetectadas | null {
    const preenchidas = linhas.slice(0, LINHAS_AMOSTRA_CONTEUDO).filter(({ celulas }) => celulas.some((celula) => celula.trim()));
    if (!preenchidas.length) {
      return null;
    }

    const compativeis = preenchidas.filter(
      ({ celulas }) =>
        celulas.length >= 3 &&
        /^[0-9A-Z]{8}$/i.test(celulas[0].trim()) &&
        /^[SN]?$/i.test(celulas[1].trim()) &&
        /^(\d{8})?$/.test(celulas[2].trim())
    );
    if (compativeis.length / preenchidas.length < PROPORCAO_MINIMA_LAYOUT_RECEITA) {
      return null;
    }

    return {
      layout: 'receita_simples',
      linhaCabecalho: 0,
      cnpj: 0,
      razaoSocial: null,
      opcao: 1,
      rotuloCnpj: ROTULO_CNPJ_RECEITA,
      rotuloRazaoSocial: null,
      rotuloOpcao: ROTULO_OPCAO_RECEITA
    };
  }

  private detectarColunasPeloConteudo(linhas: PlanilhaLinha[]): ColunasDetectadas | null {
    const cnpjsPorColuna = new Map<number, number>();
    const textosPorColuna = new Map<number, number>();

    for (const { celulas } of linhas.slice(0, LINHAS_AMOSTRA_CONTEUDO)) {
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
      layout: 'planilha',
      linhaCabecalho: 0,
      cnpj,
      razaoSocial,
      opcao: null,
      rotuloCnpj: `Coluna ${this.letraColuna(cnpj)}`,
      rotuloRazaoSocial: razaoSocial === null ? null : `Coluna ${this.letraColuna(razaoSocial)}`,
      rotuloOpcao: null
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

  private async abrirFontes(caminho: string, nomeArquivo: string): Promise<FonteLinhas[]> {
    const { size } = await stat(caminho);
    if (!size) {
      throw new BadRequestException('O arquivo enviado esta vazio.');
    }

    const inicio = await this.lerTrecho(caminho, 0, Math.min(size, 8));
    if (inicio[0] === 0xd0 && inicio[1] === 0xcf) {
      throw new BadRequestException(
        `Formato .xls (Excel 97-2003) nao suportado em "${nomeArquivo}". Salve a planilha como .xlsx ou .csv e envie novamente.`
      );
    }

    // Gzip: o navegador compacta CSVs grandes antes do envio (o nome continua o do arquivo original).
    if (inicio[0] === 0x1f && inicio[1] === 0x8b) {
      return [() => this.lerLinhasTexto(this.descompactar(createReadStream(caminho), createGunzip()))];
    }

    if (inicio.length < 4 || inicio.readUInt32LE(0) !== 0x04034b50) {
      return [() => this.lerLinhasTexto(createReadStream(caminho))];
    }

    const entradas = await this.lerDiretorioZip(caminho, size);
    if (/\.xlsx$/i.test(nomeArquivo) || entradas.some((entrada) => entrada.nome === 'xl/workbook.xml')) {
      if (size > MAX_BYTES_XLSX) {
        throw new BadRequestException('Planilha .xlsx acima de 100 MB. Salve como .csv (ou .zip com o .csv) e envie novamente.');
      }

      const planilhas = await this.lerXlsx(await readFile(caminho));
      return planilhas.map((linhas) => async function* () {
        yield linhas;
      });
    }

    const entrada = entradas
      .filter((item) => !item.nome.endsWith('/') && !item.nome.startsWith('__MACOSX/'))
      .sort((a, b) => b.tamanhoComprimido - a.tamanhoComprimido)[0];
    if (!entrada) {
      throw new BadRequestException('O arquivo .zip nao contem nenhum arquivo.');
    }

    if (/\.xlsx?$/i.test(entrada.nome)) {
      throw new BadRequestException(
        'O .zip contem uma planilha do Excel. Envie a planilha .xlsx diretamente ou compacte o arquivo .csv.'
      );
    }

    return [() => this.lerEntradaZip(caminho, entrada)];
  }

  private async *lerEntradaZip(caminho: string, entrada: EntradaZip): AsyncGenerator<PlanilhaLinha[]> {
    yield* this.lerLinhasTexto(await this.abrirEntradaZip(caminho, entrada));
  }

  private async lerTrecho(caminho: string, posicao: number, tamanho: number): Promise<Buffer> {
    const handle = await open(caminho, 'r');
    try {
      const buffer = Buffer.alloc(tamanho);
      const { bytesRead } = await handle.read(buffer, 0, tamanho, posicao);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async lerDiretorioZip(caminho: string, tamanho: number): Promise<EntradaZip[]> {
    const tamanhoFinal = Math.min(tamanho, 22 + 0xffff);
    const final = await this.lerTrecho(caminho, tamanho - tamanhoFinal, tamanhoFinal);
    let posicaoEocd = -1;
    for (let indice = final.length - 22; indice >= 0; indice -= 1) {
      if (final.readUInt32LE(indice) === 0x06054b50) {
        posicaoEocd = indice;
        break;
      }
    }
    if (posicaoEocd < 0) {
      throw new BadRequestException('Arquivo .zip invalido ou incompleto. Envie o arquivo novamente.');
    }

    let totalEntradas = final.readUInt16LE(posicaoEocd + 10);
    let tamanhoDiretorio = final.readUInt32LE(posicaoEocd + 12);
    let offsetDiretorio = final.readUInt32LE(posicaoEocd + 16);
    const localizadorZip64 = posicaoEocd - 20;
    if (localizadorZip64 >= 0 && final.readUInt32LE(localizadorZip64) === 0x07064b50) {
      const offsetEocd64 = Number(final.readBigUInt64LE(localizadorZip64 + 8));
      const eocd64 = await this.lerTrecho(caminho, offsetEocd64, 56);
      if (eocd64.length === 56 && eocd64.readUInt32LE(0) === 0x06064b50) {
        totalEntradas = Number(eocd64.readBigUInt64LE(32));
        tamanhoDiretorio = Number(eocd64.readBigUInt64LE(40));
        offsetDiretorio = Number(eocd64.readBigUInt64LE(48));
      }
    }

    if (tamanhoDiretorio > MAX_BYTES_DIRETORIO_ZIP) {
      throw new BadRequestException('O arquivo .zip tem arquivos demais. Envie apenas o arquivo com os CNPJs.');
    }

    const diretorio = await this.lerTrecho(caminho, offsetDiretorio, tamanhoDiretorio);
    const entradas: EntradaZip[] = [];
    let posicao = 0;
    for (let contador = 0; contador < totalEntradas && posicao + 46 <= diretorio.length; contador += 1) {
      if (diretorio.readUInt32LE(posicao) !== 0x02014b50) {
        break;
      }

      const tamanhoNome = diretorio.readUInt16LE(posicao + 28);
      const tamanhoExtra = diretorio.readUInt16LE(posicao + 30);
      const tamanhoComentario = diretorio.readUInt16LE(posicao + 32);
      const tamanhoOriginal32 = diretorio.readUInt32LE(posicao + 24);
      let tamanhoComprimido = diretorio.readUInt32LE(posicao + 20);
      let offsetCabecalhoLocal = diretorio.readUInt32LE(posicao + 42);
      const extra = diretorio.subarray(posicao + 46 + tamanhoNome, posicao + 46 + tamanhoNome + tamanhoExtra);
      for (let indiceExtra = 0; indiceExtra + 4 <= extra.length; ) {
        const id = extra.readUInt16LE(indiceExtra);
        const tamanhoCampo = extra.readUInt16LE(indiceExtra + 2);
        if (id === 0x0001) {
          let cursor = indiceExtra + 4;
          if (tamanhoOriginal32 === 0xffffffff) {
            cursor += 8;
          }
          if (tamanhoComprimido === 0xffffffff) {
            tamanhoComprimido = Number(extra.readBigUInt64LE(cursor));
            cursor += 8;
          }
          if (offsetCabecalhoLocal === 0xffffffff) {
            offsetCabecalhoLocal = Number(extra.readBigUInt64LE(cursor));
          }
        }
        indiceExtra += 4 + tamanhoCampo;
      }

      entradas.push({
        nome: diretorio.subarray(posicao + 46, posicao + 46 + tamanhoNome).toString('utf8'),
        metodo: diretorio.readUInt16LE(posicao + 10),
        criptografada: (diretorio.readUInt16LE(posicao + 8) & 0x1) === 0x1,
        tamanhoComprimido,
        offsetCabecalhoLocal
      });
      posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
    }

    return entradas;
  }

  private async abrirEntradaZip(caminho: string, entrada: EntradaZip): Promise<Readable> {
    if (entrada.criptografada) {
      throw new BadRequestException('O arquivo .zip esta protegido por senha. Envie o arquivo sem senha.');
    }

    if (entrada.metodo !== 0 && entrada.metodo !== 8) {
      throw new BadRequestException('Compressao do .zip nao suportada. Extraia o arquivo e envie o .csv.');
    }

    const cabecalhoLocal = await this.lerTrecho(caminho, entrada.offsetCabecalhoLocal, 30);
    if (cabecalhoLocal.length < 30 || cabecalhoLocal.readUInt32LE(0) !== 0x04034b50) {
      throw new BadRequestException('Arquivo .zip invalido ou incompleto. Envie o arquivo novamente.');
    }

    const inicioDados =
      entrada.offsetCabecalhoLocal + 30 + cabecalhoLocal.readUInt16LE(26) + cabecalhoLocal.readUInt16LE(28);
    if (!entrada.tamanhoComprimido) {
      return Readable.from([]);
    }

    const bruto = createReadStream(caminho, { start: inicioDados, end: inicioDados + entrada.tamanhoComprimido - 1 });
    return entrada.metodo === 0 ? bruto : this.descompactar(bruto, createInflateRaw());
  }

  private descompactar(bruto: Readable, descompactador: Transform): Readable {
    bruto.on('error', (error) => descompactador.destroy(error));
    return bruto.pipe(descompactador);
  }

  private async *lerLinhasTexto(bytes: AsyncIterable<Buffer>): AsyncGenerator<PlanilhaLinha[]> {
    const leitor = new LeitorCsv();
    try {
      for await (const texto of this.decodificarTexto(bytes)) {
        const linhas = leitor.processar(texto);
        if (linhas.length) {
          yield linhas;
        }
      }
    } catch (error) {
      if (String((error as { code?: unknown })?.code ?? '').startsWith('Z_')) {
        throw new BadRequestException('O arquivo compactado esta corrompido ou incompleto. Envie o arquivo novamente.');
      }
      throw error;
    }

    const finais = leitor.finalizar();
    if (finais.length) {
      yield finais;
    }
  }

  /** Decide entre UTF-8 e Windows-1252 no primeiro trecho com caractere nao ASCII. */
  private async *decodificarTexto(bytes: AsyncIterable<Buffer>): AsyncGenerator<string> {
    let decodificador: TextDecoder | null = null;
    for await (const trecho of bytes) {
      if (!decodificador) {
        const texto = trecho.toString('latin1');
        if (!/[^\x00-\x7f]/.test(texto)) {
          yield texto;
          continue;
        }
        decodificador = this.utf8Valido(trecho) ? new TextDecoder('utf-8') : new TextDecoder('windows-1252');
      }
      yield decodificador.decode(trecho, { stream: true });
    }

    if (decodificador) {
      yield decodificador.decode();
    }
  }

  private utf8Valido(trecho: Buffer): boolean {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(trecho, { stream: true });
      return true;
    } catch {
      return false;
    }
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
    for (const caminhoPlanilha of caminhos) {
      const xml = await zip.file(caminhoPlanilha)?.async('string');
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
      const caminhoPlanilha = idRelacionamento ? relacionamentos.get(idRelacionamento) : undefined;
      if (caminhoPlanilha) {
        caminhos.push(caminhoPlanilha);
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
}

/** Aplica as colunas detectadas as linhas lidas e agrupa as empresas optantes em lotes. */
class ExtratorEmpresas {
  private lote = new Map<string, PlanilhaSimplesEmpresa>();
  private readonly linhasIgnoradas: PlanilhaSimplesLinhaIgnorada[] = [];
  private totalLinhas = 0;
  private totalOptantes = 0;
  private totalNaoOptantes = 0;
  private totalIgnoradas = 0;

  constructor(
    private readonly parser: SimplesNacionalPlanilhaParserService,
    private readonly colunas: ColunasDetectadas,
    private readonly opcoes: PlanilhaSimplesOpcoes
  ) {}

  async processar(linhas: PlanilhaLinha[]): Promise<void> {
    const { colunas } = this;
    const aceitarRaizAlfanumerica = colunas.layout === 'receita_simples';

    for (const { linha, celulas } of linhas) {
      if (linha <= colunas.linhaCabecalho || celulas.every((celula) => !celula.trim())) {
        continue;
      }

      this.totalLinhas += 1;
      if (colunas.opcao !== null && !this.valorIndicaOptante(celulas[colunas.opcao])) {
        this.totalNaoOptantes += 1;
        continue;
      }

      const valorCnpj = (celulas[colunas.cnpj] ?? '').trim();
      const normalizado = valorCnpj ? this.parser.normalizarCnpj(valorCnpj, aceitarRaizAlfanumerica) : null;
      if (!normalizado) {
        this.ignorar(linha, valorCnpj, valorCnpj ? 'CNPJ invalido' : 'CNPJ nao informado');
        continue;
      }

      this.totalOptantes += 1;
      const razaoSocial = colunas.razaoSocial === null ? null : this.normalizarTexto(celulas[colunas.razaoSocial]);
      this.adicionarAoLote({ ...normalizado, razaoSocial, linha });
      if (this.lote.size >= this.opcoes.tamanhoLote) {
        await this.enviarLote();
      }
    }

    this.opcoes.onProgresso?.(this.totalLinhas);
  }

  async finalizar(): Promise<PlanilhaSimplesResumo> {
    await this.enviarLote();
    return {
      layout: this.colunas.layout,
      colunaCnpj: this.colunas.rotuloCnpj,
      colunaRazaoSocial: this.colunas.rotuloRazaoSocial,
      colunaOpcao: this.colunas.rotuloOpcao,
      totalLinhas: this.totalLinhas,
      totalOptantes: this.totalOptantes,
      totalNaoOptantes: this.totalNaoOptantes,
      totalIgnoradas: this.totalIgnoradas,
      linhasIgnoradas: this.linhasIgnoradas
    };
  }

  private adicionarAoLote(empresa: PlanilhaSimplesEmpresa): void {
    const existente = this.lote.get(empresa.cnpjBase);
    if (!existente) {
      this.lote.set(empresa.cnpjBase, empresa);
      return;
    }

    existente.razaoSocial = existente.razaoSocial ?? empresa.razaoSocial;
    const substituirPorMatriz =
      Boolean(existente.cnpj) && this.isMatriz(empresa.cnpj ?? '') && !this.isMatriz(existente.cnpj ?? '');
    if (empresa.cnpj && (!existente.cnpj || substituirPorMatriz)) {
      existente.cnpj = empresa.cnpj;
    }
  }

  private async enviarLote(): Promise<void> {
    if (!this.lote.size) {
      return;
    }

    const empresas = [...this.lote.values()];
    this.lote = new Map();
    await this.opcoes.onLote(empresas);
  }

  private ignorar(linha: number, valor: string, motivo: string): void {
    this.totalIgnoradas += 1;
    if (this.linhasIgnoradas.length < MAX_LINHAS_IGNORADAS) {
      this.linhasIgnoradas.push({ linha, valor: valor.slice(0, 60), motivo });
    }
  }

  private valorIndicaOptante(valor: string | undefined): boolean {
    const texto = String(valor || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (!texto || texto.startsWith('nao')) {
      return false;
    }

    return VALORES_OPTANTE.has(texto) || texto.includes('simples') || texto.includes('optante');
  }

  private isMatriz(cnpj: string): boolean {
    return cnpj.slice(8, 12) === '0001';
  }

  private normalizarTexto(valor: string | undefined): string | null {
    const texto = String(valor || '').trim().replace(/\s+/g, ' ');
    return texto ? texto.slice(0, 255) : null;
  }
}

/** Parser de CSV incremental: recebe trechos de texto e devolve os registros completos (aspas multilinha incluidas). */
class LeitorCsv {
  private static readonly MAX_LINHAS_POR_REGISTRO = 20;
  private resto = '';
  private pendentes: Array<{ linha: number; texto: string }> = [];
  private numeroLinha = 0;
  private separador: string | null = null;

  processar(texto: string): PlanilhaLinha[] {
    const partes = (this.resto + texto).split('\n');
    this.resto = partes.pop() ?? '';
    return this.processarLinhasFisicas(partes);
  }

  finalizar(): PlanilhaLinha[] {
    const partes = this.resto ? [this.resto] : [];
    this.resto = '';
    const linhas = this.processarLinhasFisicas(partes);
    if (this.pendentes.length) {
      linhas.push(this.criarLinha(this.pendentes.map((item) => item.texto).join('\n'), this.pendentes[0].linha));
      this.pendentes = [];
    }

    return linhas;
  }

  private processarLinhasFisicas(partes: string[]): PlanilhaLinha[] {
    const linhas: PlanilhaLinha[] = [];
    for (const parte of partes) {
      this.numeroLinha += 1;
      const texto = parte.endsWith('\r') ? parte.slice(0, -1) : parte;
      if (this.separador === null && texto.trim()) {
        this.separador = this.detectarSeparador(texto);
      }

      this.pendentes.push({ linha: this.numeroLinha, texto });
      const registro = this.pendentes.length === 1 ? texto : this.pendentes.map((item) => item.texto).join('\n');
      const celulas = this.dividirCelulas(registro, this.separador ?? ';', false);
      if (celulas) {
        linhas.push({ linha: this.pendentes[0].linha, celulas });
        this.pendentes = [];
      } else if (this.pendentes.length >= LeitorCsv.MAX_LINHAS_POR_REGISTRO) {
        // Aspas abertas sem fechamento: le cada linha isoladamente em vez de acumular o resto do arquivo.
        linhas.push(...this.pendentes.map((item) => this.criarLinha(item.texto, item.linha)));
        this.pendentes = [];
      }
    }

    return linhas;
  }

  private criarLinha(registro: string, linha: number): PlanilhaLinha {
    return { linha, celulas: this.dividirCelulas(registro, this.separador ?? ';', true) ?? [registro] };
  }

  /** Retorna null quando o registro termina dentro de um campo entre aspas (continua na proxima linha). */
  private dividirCelulas(registro: string, separador: string, aceitarIncompleto: boolean): string[] | null {
    const celulas: string[] = [];
    let posicao = 0;
    for (;;) {
      let valor = '';
      if (registro[posicao] === '"') {
        let cursor = posicao + 1;
        for (;;) {
          const aspas = registro.indexOf('"', cursor);
          if (aspas < 0) {
            if (!aceitarIncompleto) {
              return null;
            }
            valor += registro.slice(cursor);
            posicao = registro.length;
            break;
          }
          if (registro[aspas + 1] === '"') {
            valor += registro.slice(cursor, aspas + 1);
            cursor = aspas + 2;
            continue;
          }
          valor += registro.slice(cursor, aspas);
          posicao = aspas + 1;
          break;
        }
      }

      const proximo = registro.indexOf(separador, posicao);
      if (proximo < 0) {
        celulas.push(valor + registro.slice(posicao));
        return celulas;
      }

      celulas.push(valor + registro.slice(posicao, proximo));
      posicao = proximo + separador.length;
    }
  }

  private detectarSeparador(linha: string): string {
    let melhor = ';';
    let melhorContagem = 0;
    for (const candidato of [';', ',', '\t', '|']) {
      const contagem = linha.split(candidato).length - 1;
      if (contagem > melhorContagem) {
        melhor = candidato;
        melhorContagem = contagem;
      }
    }

    return melhor;
  }
}
