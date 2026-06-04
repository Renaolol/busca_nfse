import { NfseDanfseService } from '../nfse-danfse.service';

describe('NfseDanfseService', () => {
  const service = new NfseDanfseService();

  it('gera PDF basico a partir de XML com fallback', () => {
    const xml = `
      <NFSe>
        <nNFSe>123</nNFSe>
        <dhEmi>2026-05-19T10:00:00-03:00</dhEmi>
        <prestador>
          <CNPJ>12345678000199</CNPJ>
          <xNome>Empresa Teste LTDA</xNome>
        </prestador>
        <toma>
          <CNPJ>11222333000144</CNPJ>
          <xNome>Tomador Exemplo SA</xNome>
        </toma>
        <vServ>1500.00</vServ>
        <xDescServ>Servico de teste</xDescServ>
      </NFSe>
    `;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42110092206960810000176000000000000126019687178145'
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.toString('latin1', 0, 8)).toBe('%PDF-1.4');

    const content = pdf.toString('latin1');
    expect(content).toContain('DANFSe v1.0');
    expect(content).toContain('Documento Auxiliar da NFS-e');
    expect(content).toContain('Chave de Acesso da NFS-e');
    expect(content).toContain('EMITENTE DA NFS-E');
    expect(content).toContain('TOMADOR DO SERVICO');
    expect(content).toContain('SERVICO PRESTADO');
    expect(content).toContain('TRIBUTACAO MUNICIPAL');
    expect(content).toContain('TRIBUTACAO FEDERAL');
    expect(content).toContain('VALOR TOTAL DA NFS-E');
    expect(content).toContain('INFORMACOES COMPLEMENTARES');
    expect(content).not.toContain('Padrao Nacional');
    expect(content.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('marca visualmente DANFSE cancelada', () => {
    const pdf = service.generatePdf({
      chaveAcesso: '42110092206960810000176000000000033326062205552016',
      numeroNfse: '333',
      status: 'Cancelada',
      cnpjPrestador: '06960810000176',
      razaoSocialPrestador: 'GCONT GESTAO CONTABIL E EMPRESARIAL LTDA',
      cnpjTomador: '58663383000168',
      razaoSocialTomador: 'EKTEL PROVEDOR SPE LTDA',
      municipioPrestador: 'Mondai / SC',
      valorServico: '180.00',
      descricaoServico: 'CERTIFICADO DIGITAL E-CNPJ'
    });

    const content = pdf.toString('latin1');
    expect(content).toContain('CANCELADA');
    expect(content).toContain('MUNICIPIO DE MONDAI');
    expect(content.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});
