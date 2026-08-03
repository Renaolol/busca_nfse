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

  it('preenche DANFSE a partir de XML ABRASF classico e preserva cancelamento do XML', () => {
    const xml = `
      <CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
        <Nfse versao="1.00">
          <InfNfse>
            <Numero>4</Numero>
            <CodigoVerificacao>42076502210413042000108000000000000426060684124896</CodigoVerificacao>
            <DataEmissao>2026-06-15T09:45:30-03:00</DataEmissao>
            <ValoresNfse>
              <BaseCalculo>1566.72</BaseCalculo>
              <Aliquota>0.00</Aliquota>
              <ValorIss>0.00</ValorIss>
            </ValoresNfse>
            <PrestadorServico>
              <IdentificacaoPrestador>
                <CpfCnpj>
                  <Cnpj>10413042000108</Cnpj>
                </CpfCnpj>
                <InscricaoMunicipal>6762</InscricaoMunicipal>
              </IdentificacaoPrestador>
              <RazaoSocial>KLAGENBERG &amp; KLAGENBERG LTDA</RazaoSocial>
              <Endereco>
                <Endereco>Rua Simoes</Endereco>
                <Numero>145</Numero>
                <Bairro>Centro</Bairro>
                <CodigoMunicipio>4207650</CodigoMunicipio>
                <Uf>SC</Uf>
                <Cep>89899000</Cep>
              </Endereco>
              <Contato>
                <Telefone>4936341082</Telefone>
                <Email>financeiro@empresa.test</Email>
              </Contato>
            </PrestadorServico>
            <DeclaracaoPrestacaoServico>
              <InfDeclaracaoPrestacaoServico>
                <Competencia>2026-06-15T00:00:00</Competencia>
                <Servico>
                  <Valores>
                    <ValorServicos>1566.72</ValorServicos>
                  </Valores>
                  <IssRetido>2</IssRetido>
                  <ItemListaServico>1706</ItemListaServico>
                  <Discriminacao>Servico de publicidade institucional</Discriminacao>
                  <CodigoMunicipio>4207650</CodigoMunicipio>
                  <ExigibilidadeISS>1</ExigibilidadeISS>
                  <MunicipioIncidencia>4207650</MunicipioIncidencia>
                </Servico>
                <Tomador>
                  <IdentificacaoTomador>
                    <CpfCnpj>
                      <Cnpj>83599191000187</Cnpj>
                    </CpfCnpj>
                  </IdentificacaoTomador>
                  <RazaoSocial>ASSEMBLEIA LEGISLATIVA DO ESTADO DE SANTA CATARINA</RazaoSocial>
                  <Endereco>
                    <Endereco>RUA JORGE LUZ FONTES</Endereco>
                    <Numero>310</Numero>
                    <Bairro>CENTRO</Bairro>
                    <CodigoMunicipio>4205407</CodigoMunicipio>
                    <Cep>88020900</Cep>
                  </Endereco>
                </Tomador>
                <OptanteSimplesNacional>1</OptanteSimplesNacional>
              </InfDeclaracaoPrestacaoServico>
            </DeclaracaoPrestacaoServico>
          </InfNfse>
        </Nfse>
        <NfseCancelamento>
          <Confirmacao>
            <Pedido>
              <InfPedidoCancelamento>
                <DataHora>2026-06-15T09:50:10-03:00</DataHora>
              </InfPedidoCancelamento>
            </Pedido>
          </Confirmacao>
        </NfseCancelamento>
      </CompNfse>
    `;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42076502210413042000108000000000000426060684124896',
      status: 'Autorizada',
      municipioPrestador: 'IPORA DO OESTE / SC'
    });

    const content = pdf.toString('latin1');

    expect(content).toContain('CANCELADA');
    expect(content).toContain('MUNICIPIO DE IPORA DO OESTE');
    expect(content).toContain('42076502210413042000108000000000000426060684124896');
    expect(content).toContain('10.413.042/0001-08');
    expect(content).toContain('6762');
    expect(content).toContain('\\(49\\) 3634-1082');
    expect(content).toContain('financeiro@empresa.test');
    expect(content).toContain('Rua Simoes, 145, Centro');
    expect(content).toContain('89899-000');
    expect(content).toContain('Optante');
    expect(content).toContain('ASSEMBLEIA LEGISLATIVA DO ESTADO DE SANTA CATARINA');
    expect(content).toContain('RUA JORGE LUZ FONTES, 310, CENTRO');
    expect(content).toContain('88020-900');
    expect(content).toContain('15/06/2026');
    expect(content).not.toContain('14/06/2026');
    expect(content).toContain('Retido');
    expect(content).toContain('1.566,72');
    expect(content).toContain('Servico de publicidade institucional');
  });

  it('substitui codigo do municipio pelo nome quando o nome estiver disponivel no fallback', () => {
    const pdf = service.generatePdf({
      chaveAcesso: '42110092206960810000176000000000000126019687178145',
      numeroNfse: '2',
      cnpjPrestador: '36926971000104',
      razaoSocialPrestador: 'JAEGER PRESTADORA DE SERVICOS LTDA',
      municipioPrestador: '4211009 / SC',
      municipioTomador: '4211009',
      municipioPrestacaoCodigo: '4211009',
      municipioPrestacaoNome: 'Mondai',
      localPrestacao: '4211009 / SC',
      municipioIncidenciaIssqn: '4211009 / SC',
      valorServico: '150.00',
      descricaoServico: 'Prestacao de servico de abertura de porta'
    });

    const content = pdf.toString('latin1');

      expect(content).toContain('MUNICIPIO DE MONDAI');
      expect(content).toContain('Mondai - SC');
      expect(content).toContain('Municipio de Incidencia do ISSQN');
  });

  it('preenche tributacao municipal a partir de vBC e pAliqAplic do layout nacional', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS23044001241109394000106000000000010926070838769673">
    <xLocEmi>FORTALEZA</xLocEmi>
    <nNFSe>109</nNFSe>
    <dhProc>2026-07-02T11:48:09-00:00</dhProc>
    <emit>
      <CNPJ>41109394000106</CNPJ>
      <xNome>LABRAND SCHOOL LTDA</xNome>
    </emit>
    <valores>
      <vBC>890.00</vBC>
      <pAliqAplic>2.40</pAliqAplic>
      <vISSQN>21.36</vISSQN>
    </valores>
    <DPS versao="1.00">
      <infDPS Id="DPS230440024110939400010600001000000000000109">
        <dhEmi>2026-07-02T11:48:09-00:00</dhEmi>
        <dCompet>2026-07-01</dCompet>
        <prest>
          <CNPJ>41109394000106</CNPJ>
        </prest>
        <toma>
          <CNPJ>23743325000160</CNPJ>
          <xNome>ALBRECHT &amp; BORNHOLDT LTDA ME</xNome>
        </toma>
        <serv>
          <cServ>
            <xDescServ>Edição de Materiais</xDescServ>
          </cServ>
        </serv>
        <valores>
          <vServPrest>
            <vServ>890.00</vServ>
          </vServPrest>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '23044001241109394000106000000000010926070838769673'
    });

    const content = pdf.toString('latin1');

    expect(content).toContain('BC ISSQN');
    expect(content).toContain('R$ 890,00');
    expect(content).toContain('Aliquota Aplicada');
    expect(content).toContain('2,40 %');
    expect(content).toContain('ISSQN Apurado');
    expect(content).toContain('R$ 21,36');
  });
});
