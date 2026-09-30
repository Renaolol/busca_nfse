import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { SimplesNacionalPlanilhaParserService } from '../simples-nacional-planilha-parser.service';

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

describe('SimplesNacionalPlanilhaParserService', () => {
  const parser = new SimplesNacionalPlanilhaParserService();

  it('le CSV com cabecalho, separador ponto e virgula e CNPJ formatado', async () => {
    const csv = [
      'Codigo;Razao Social;CNPJ',
      '1;"PADARIA BOM PAO; LTDA";11.222.333/0001-81',
      '2;OFICINA DO ZE;04.252.011/0001-10',
      '',
      '3;SEM CNPJ;',
      '4;CNPJ ERRADO;11.222.333/0001-00'
    ].join('\r\n');

    const result = await parser.parse('empresas.csv', Buffer.from(csv, 'utf-8'));

    expect(result.colunaCnpj).toBe('CNPJ');
    expect(result.colunaRazaoSocial).toBe('Razao Social');
    expect(result.totalLinhas).toBe(4);
    expect(result.empresas).toEqual([
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA BOM PAO; LTDA', linha: 2 },
      { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA DO ZE', linha: 3 }
    ]);
    expect(result.ignoradas).toEqual([
      { linha: 5, valor: '', motivo: 'CNPJ nao informado' },
      { linha: 6, valor: '11.222.333/0001-00', motivo: 'CNPJ invalido' }
    ]);
  });

  it('decodifica CSV exportado em Windows-1252 com cabecalho acentuado', async () => {
    const csv = 'CNPJ,Razão Social\n98765432000198,CONFECÇÕES AÇAÍ\n';

    const result = await parser.parse('empresas.csv', Buffer.from(csv, 'latin1'));

    expect(result.colunaRazaoSocial).toBe('Razão Social');
    expect(result.empresas[0]).toEqual(
      expect.objectContaining({ cnpj: '98765432000198', razaoSocial: 'CONFECÇÕES AÇAÍ' })
    );
  });

  it('agrupa filiais pela raiz do CNPJ e prioriza o CNPJ da matriz', async () => {
    const csv = ['CNPJ;Nome', '11222333000262;FILIAL', '11222333000181;MATRIZ', '11222333;RAIZ'].join('\n');

    const result = await parser.parse('empresas.txt', Buffer.from(csv));

    expect(result.empresas).toEqual([
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'FILIAL', linha: 2 }
    ]);
    expect(result.totalDuplicadas).toBe(2);
  });

  it('aceita CNPJ alfanumerico com digito verificador valido', async () => {
    const result = await parser.parse('empresas.csv', Buffer.from('CNPJ\n12.ABC.345/01DE-35\n12.ABC.345/01DE-36\n'));

    expect(result.empresas).toEqual([
      { cnpjBase: '12ABC345', cnpj: '12ABC34501DE35', razaoSocial: null, linha: 2 }
    ]);
    expect(result.ignoradas).toEqual([{ linha: 3, valor: '12.ABC.345/01DE-36', motivo: 'CNPJ invalido' }]);
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

    const result = await parser.parse('empresas.xlsx', buffer);

    expect(result.colunaCnpj).toBe('C.N.P.J.');
    expect(result.colunaRazaoSocial).toBe('Nome Empresarial');
    expect(result.empresas).toEqual([
      { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA DO ZE', linha: 4 },
      { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'M & M COMERCIO', linha: 5 }
    ]);
  });

  it('identifica a coluna de CNPJ pelo conteudo quando nao ha cabecalho', async () => {
    const csv = ['PADARIA BOM PAO;11222333000181', 'OFICINA DO ZE;04252011000110'].join('\n');

    const result = await parser.parse('empresas.csv', Buffer.from(csv));

    expect(result.colunaCnpj).toBe('Coluna B');
    expect(result.colunaRazaoSocial).toBe('Coluna A');
    expect(result.empresas.map((empresa) => empresa.razaoSocial)).toEqual(['PADARIA BOM PAO', 'OFICINA DO ZE']);
  });

  it('rejeita planilha sem coluna de CNPJ', async () => {
    await expect(parser.parse('empresas.csv', Buffer.from('Nome;Cidade\nPADARIA;Cascavel\n'))).rejects.toThrow(
      BadRequestException
    );
  });

  it('rejeita arquivo .xls no formato binario antigo', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    await expect(parser.parse('empresas.xls', xls)).rejects.toThrow('Formato .xls');
  });
});
