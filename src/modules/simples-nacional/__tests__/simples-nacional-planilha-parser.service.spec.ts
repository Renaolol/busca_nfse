import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PlanilhaSimplesEmpresa,
  SimplesNacionalPlanilhaParserService
} from '../simples-nacional-planilha-parser.service';

async function criarXlsx(sheetXml: string, sharedStrings: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Empresas" sheetId="1" r:id="rId1"/></sheets></workbook>'
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/planilha-empresas.xml"/></Relationships>'
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sharedStrings
      .map((texto) => `<si><t>${texto}</t></si>`)
      .join('')}</sst>`
  );
  zip.file(
    'xl/worksheets/planilha-empresas.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

function linhaReceita(cnpjBasico: string, opcao: string): string {
  const dataExclusao = opcao === 'S' ? '00000000' : '20240101';
  return `"${cnpjBasico}";"${opcao}";"20180101";"${dataExclusao}";"N";"00000000";"00000000"`;
}

describe('SimplesNacionalPlanilhaParserService', () => {
  const parser = new SimplesNacionalPlanilhaParserService();
  let diretorio: string;

  beforeAll(async () => {
    diretorio = await mkdtemp(join(tmpdir(), 'simples-parser-spec-'));
  });

  afterAll(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  async function processar(nomeArquivo: string, conteudo: Buffer, tamanhoLote = 1000) {
    const caminho = join(diretorio, `${Date.now()}-${Math.random().toString(36).slice(2)}-${nomeArquivo}`);
    await writeFile(caminho, conteudo);
    const lotes: PlanilhaSimplesEmpresa[][] = [];
    const resumo = await parser.processarArquivo(caminho, nomeArquivo, {
      tamanhoLote,
      onLote: async (empresas) => {
        lotes.push(empresas);
      }
    });
    return { resumo, lotes, empresas: lotes.flat() };
  }

  it('le CSV com cabecalho, separador ponto e virgula e CNPJ formatado', async () => {
    const csv = [
      'Codigo;Razao Social;CNPJ',
      '1;"PADARIA BOM PAO; LTDA";11.222.333/0001-81',
      '2;OFICINA DO ZE;04.252.011/0001-10',
      '',
      '3;SEM CNPJ;',
      '4;CNPJ ERRADO;11.222.333/0001-00'
    ].join('\r\n');

    const { resumo, empresas } = await processar('empresas.csv', Buffer.from(csv, 'utf-8'));

    expect(resumo).toEqual(
      expect.objectContaining({
        layout: 'planilha',
        colunaCnpj: 'CNPJ',
        colunaRazaoSocial: 'Razao Social',
        colunaOpcao: null,
        totalLinhas: 4,
        totalOptantes: 2,
        totalIgnoradas: 2,
        linhasIgnoradas: [
          { linha: 5, valor: '', motivo: 'CNPJ nao informado' },
          { linha: 6, valor: '11.222.333/0001-00', motivo: 'CNPJ invalido' }
        ]
      })
    );
    expect(empresas).toEqual([
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA BOM PAO; LTDA', linha: 2 },
      { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA DO ZE', linha: 3 }
    ]);
  });

  it('decodifica CSV exportado em Windows-1252 com cabecalho acentuado', async () => {
    const csv = 'CNPJ,Razão Social\n98765432000198,CONFECÇÕES AÇAÍ\n';

    const { resumo, empresas } = await processar('empresas.csv', Buffer.from(csv, 'latin1'));

    expect(resumo.colunaRazaoSocial).toBe('Razão Social');
    expect(empresas[0]).toEqual(expect.objectContaining({ cnpj: '98765432000198', razaoSocial: 'CONFECÇÕES AÇAÍ' }));
  });

  it('detecta a codificacao mesmo quando o primeiro acento aparece depois do primeiro trecho do arquivo', async () => {
    const linhas = ['CNPJ;Nome'];
    for (let indice = 0; indice < 5000; indice += 1) {
      linhas.push(`${String(10000000 + indice)};EMPRESA ${indice}`);
    }
    linhas.push('20000000;CONFECÇÕES FINAL');

    const { empresas, lotes } = await processar('grande.csv', Buffer.from(linhas.join('\n'), 'latin1'), 2000);

    expect(empresas).toHaveLength(5001);
    expect(lotes.map((lote) => lote.length)).toEqual([2000, 2000, 1001]);
    expect(empresas[5000]).toEqual({ cnpjBase: '20000000', cnpj: null, razaoSocial: 'CONFECÇÕES FINAL', linha: 5002 });
  });

  it('agrupa filiais pela raiz do CNPJ e prioriza o CNPJ da matriz', async () => {
    const csv = ['CNPJ;Nome', '11222333000262;FILIAL', '11222333000181;MATRIZ', '11222333;RAIZ'].join('\n');

    const { resumo, empresas } = await processar('empresas.txt', Buffer.from(csv));

    expect(empresas).toEqual([{ cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'FILIAL', linha: 2 }]);
    expect(resumo.totalOptantes).toBe(3);
  });

  it('aceita CNPJ alfanumerico com digito verificador valido', async () => {
    const { resumo, empresas } = await processar(
      'empresas.csv',
      Buffer.from('CNPJ\n12.ABC.345/01DE-35\n12.ABC.345/01DE-36\n')
    );

    expect(empresas).toEqual([{ cnpjBase: '12ABC345', cnpj: '12ABC34501DE35', razaoSocial: null, linha: 2 }]);
    expect(resumo.linhasIgnoradas).toEqual([{ linha: 3, valor: '12.ABC.345/01DE-36', motivo: 'CNPJ invalido' }]);
  });

  it('mantem campos com quebra de linha entre aspas e aspas soltas no meio do texto', async () => {
    const csv = 'CNPJ;Nome\n11222333000181;"PADARIA\nCENTRAL"\n04252011000110;TUBOS 1/2" LTDA\n98765432000198;OUTRA\n';

    const { empresas } = await processar('empresas.csv', Buffer.from(csv));

    expect(empresas).toEqual([
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA CENTRAL', linha: 2 },
      { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'TUBOS 1/2" LTDA', linha: 4 },
      { cnpjBase: '98765432', cnpj: '98765432000198', razaoSocial: 'OUTRA', linha: 5 }
    ]);
  });

  it('considera apenas as linhas marcadas como optantes quando ha coluna de opcao', async () => {
    const csv = [
      'CNPJ;Razao Social;Opção pelo Simples;Data Opção',
      '11222333000181;PADARIA;S;01/01/2020',
      '04252011000110;INDUSTRIA;N;01/01/2020',
      '98765432000198;MEI DO ZE;Sim;01/01/2021',
      '12ABC34501DE35;SEM OPCAO;;'
    ].join('\n');

    const { resumo, empresas } = await processar('empresas.csv', Buffer.from(csv));

    expect(resumo).toEqual(
      expect.objectContaining({ colunaOpcao: 'Opção pelo Simples', totalLinhas: 4, totalOptantes: 2, totalNaoOptantes: 2 })
    );
    expect(empresas.map((empresa) => empresa.cnpjBase)).toEqual(['11222333', '98765432']);
  });

  it('le o arquivo Simples da Receita Federal (sem cabecalho) e grava apenas opcao S', async () => {
    const csv = [
      linhaReceita('00000001', 'N'),
      linhaReceita('11222333', 'S'),
      linhaReceita('04252011', 'N'),
      linhaReceita('AB12CD34', 'S'),
      linhaReceita('00000000', 'S')
    ].join('\n');

    const { resumo, empresas } = await processar('simples.csv', Buffer.from(csv, 'latin1'));

    expect(resumo).toEqual(
      expect.objectContaining({
        layout: 'receita_simples',
        colunaCnpj: 'CNPJ basico (arquivo Simples da Receita Federal)',
        colunaOpcao: 'Opcao pelo Simples (S/N)',
        totalLinhas: 5,
        totalOptantes: 2,
        totalNaoOptantes: 2,
        totalIgnoradas: 1
      })
    );
    expect(empresas).toEqual([
      { cnpjBase: '11222333', cnpj: null, razaoSocial: null, linha: 2 },
      { cnpjBase: 'AB12CD34', cnpj: null, razaoSocial: null, linha: 4 }
    ]);
  });

  it('le o CSV direto de dentro do .zip da Receita, em lotes', async () => {
    const linhas: string[] = [];
    for (let indice = 0; indice < 12000; indice += 1) {
      linhas.push(linhaReceita(String(10000000 + indice), indice % 4 === 0 ? 'N' : 'S'));
    }
    const zip = new JSZip();
    zip.file('F.K03200$W.SIMPLES.CSV.D50913', linhas.join('\n'));
    const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const { resumo, lotes } = await processar('Simples.zip', conteudo, 5000);

    expect(resumo).toEqual(
      expect.objectContaining({ layout: 'receita_simples', totalLinhas: 12000, totalOptantes: 9000, totalNaoOptantes: 3000 })
    );
    expect(lotes.map((lote) => lote.length)).toEqual([5000, 4000]);
    expect(lotes[0][0]).toEqual({ cnpjBase: '10000001', cnpj: null, razaoSocial: null, linha: 2 });
  });

  it('le XLSX com textos compartilhados e CNPJ numerico sem zero a esquerda', async () => {
    const buffer = await criarXlsx(
      [
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
        '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c></row>',
        '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4"><v>4252011000110</v></c></row>',
        '<row r="5"><c r="A5" t="inlineStr"><is><t>M &amp; M COMERCIO</t></is></c><c r="C5" t="str"><v>11.222.333/0001-81</v></c></row>'
      ].join(''),
      ['RELACAO DE EMPRESAS OPTANTES', 'Nome Empresarial', 'C.N.P.J.', 'OFICINA DO ZE']
    );

    const { resumo, empresas } = await processar('empresas.xlsx', buffer);

    expect(resumo.colunaCnpj).toBe('C.N.P.J.');
    expect(resumo.colunaRazaoSocial).toBe('Nome Empresarial');
    expect(empresas).toEqual([
      { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA DO ZE', linha: 4 },
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'M & M COMERCIO', linha: 5 }
    ]);
  });

  it('identifica a coluna de CNPJ pelo conteudo quando nao ha cabecalho', async () => {
    const csv = ['PADARIA BOM PAO;11222333000181', 'OFICINA DO ZE;04252011000110'].join('\n');

    const { resumo, empresas } = await processar('empresas.csv', Buffer.from(csv));

    expect(resumo.colunaCnpj).toBe('Coluna B');
    expect(resumo.colunaRazaoSocial).toBe('Coluna A');
    expect(empresas.map((empresa) => empresa.razaoSocial)).toEqual(['PADARIA BOM PAO', 'OFICINA DO ZE']);
  });

  it('rejeita planilha sem coluna de CNPJ', async () => {
    await expect(processar('empresas.csv', Buffer.from('Nome;Cidade\nPADARIA;Cascavel\n'))).rejects.toThrow(
      BadRequestException
    );
  });

  it('rejeita arquivo .xls no formato binario antigo', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    await expect(processar('empresas.xls', xls)).rejects.toThrow('Formato .xls');
  });

  it('rejeita .zip que contem planilha do Excel', async () => {
    const zip = new JSZip();
    zip.file('empresas.xlsx', 'conteudo');
    const conteudo = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(processar('empresas.zip', conteudo)).rejects.toThrow('planilha do Excel');
  });
});
