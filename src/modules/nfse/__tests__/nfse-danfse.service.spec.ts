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
    expect(content).toContain('Nao Retido');
    expect(content).toContain('1.566,72');
    expect(content).toContain('Servico de publicidade institucional');
  });

  it('evidencia retencoes federais em XML ABRASF classico', () => {
    const xml = `
      <CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
        <Nfse versao="1.00">
          <InfNfse>
            <Numero>425</Numero>
            <CodigoVerificacao>42082032211496705000168000000000042526078195939549</CodigoVerificacao>
            <DataEmissao>2026-07-24T10:35:20-03:00</DataEmissao>
            <ValoresNfse>
              <BaseCalculo>350.00</BaseCalculo>
              <Aliquota>3.00</Aliquota>
              <ValorIss>10.50</ValorIss>
              <ValorLiquidoNfse>328.47</ValorLiquidoNfse>
            </ValoresNfse>
            <PrestadorServico>
              <IdentificacaoPrestador>
                <CpfCnpj>
                  <Cnpj>11496705000168</Cnpj>
                </CpfCnpj>
              </IdentificacaoPrestador>
              <RazaoSocial>MULTISAT NOX GERENCIAMENTO E MONITORAMENTO DE RISCO LTDA</RazaoSocial>
            </PrestadorServico>
            <DeclaracaoPrestacaoServico>
              <InfDeclaracaoPrestacaoServico>
                <Competencia>2026-07-24T00:00:00</Competencia>
                <Servico>
                  <Valores>
                    <ValorServicos>350.00</ValorServicos>
                    <ValorPis>2.28</ValorPis>
                    <ValorCofins>10.50</ValorCofins>
                    <ValorIr>5.25</ValorIr>
                    <ValorCsll>16.28</ValorCsll>
                    <OutrasRetencoes>21.53</OutrasRetencoes>
                    <ValorIss>10.50</ValorIss>
                  </Valores>
                  <IssRetido>2</IssRetido>
                  <ItemListaServico>1701</ItemListaServico>
                  <Discriminacao>Minimo Mensal de Monitoramento Nox</Discriminacao>
                </Servico>
                <Tomador>
                  <IdentificacaoTomador>
                    <CpfCnpj>
                      <Cnpj>32973310000189</Cnpj>
                    </CpfCnpj>
                  </IdentificacaoTomador>
                  <RazaoSocial>H.M. Rother Transportes Ltda</RazaoSocial>
                </Tomador>
              </InfDeclaracaoPrestacaoServico>
            </DeclaracaoPrestacaoServico>
          </InfNfse>
        </Nfse>
      </CompNfse>
    `;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42082032211496705000168000000000042526078195939549'
    });

    const content = pdf.toString('latin1');

    expect(content).toContain('IRRF');
    expect(content).toContain('R$ 5,25');
    expect(content).toContain('Contribuicoes Sociais - Retidas');
    expect(content).toContain('R$ 16,28');
    expect(content).toContain('PIS Retido');
    expect(content).toContain('R$ 2,28');
    expect(content).toContain('COFINS Retido');
    expect(content).toContain('R$ 10,50');
    expect(content).toContain('Total das Retencoes Federais');
    expect(content).toContain('R$ 34,31');
  });

  it('extrai leitura fiscal consolidada do layout nacional', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42110092206960810000176000000000033326062205552016">
    <xLocPrestacao>Mondai</xLocPrestacao>
    <xLocIncid>Mondai</xLocIncid>
    <nNFSe>333</nNFSe>
    <valores>
      <vServ>180.00</vServ>
      <vLiq>162.00</vLiq>
      <vTotalRet>18.00</vTotalRet>
      <vISSQN>9.00</vISSQN>
      <vISSRet>9.00</vISSRet>
      <pAliqAplic>5.00</pAliqAplic>
      <trib>
        <tribFed>
          <vRetIRRF>3.00</vRetIRRF>
          <vRetCP>2.00</vRetCP>
          <vRetCSLL>1.50</vRetCSLL>
          <piscofins>
            <vPis>1.00</vPis>
            <vCofins>1.50</vCofins>
          </piscofins>
        </tribFed>
        <tribMun>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
      </trib>
    </valores>
  </infNFSe>
</NFSe>`;

    const leitura = service.extractLeituraFiscal(xml);

    expect(leitura.layout).toBe('padrao_nacional');
    expect(leitura.localPrestacao).toBe('Mondai');
    expect(leitura.localIncidenciaIss).toBe('Mondai');
    expect(leitura.valorServico).toBe('180.00');
    expect(leitura.valorLiquidoNfse).toBe('162.00');
    expect(leitura.valorTotalRetencoes).toBe('18.00');
    expect(leitura.valorIssRetidoReal).toBe('9.00');
    expect(leitura.aliquotaIss).toBe('5.00');
    expect(leitura.aliquotaRealIss).toBe('5.00');
    expect(leitura.retencaoIss).toBe('Retido');
    expect(leitura.retencaoFederal).toBe('Retido');
    expect(leitura.totalRetencoesFederais).toBe('6.50');
    expect(leitura.statusProcessamento).toBe('OK');
    expect(leitura.camposComProblema).toEqual([]);
  });

  it('usa tpRetPisCofins do layout nacional como indicativo de retencao sem somar vPis/vCofins nas retencoes federais', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42076502246555046000178000000000042626088527978389">
    <nNFSe>426</nNFSe>
    <valores>
      <vServ>2000.00</vServ>
      <vLiq>1934.00</vLiq>
      <vISSQN>100.00</vISSQN>
      <trib>
        <tribFed>
          <piscofins>
            <vPis>13.00</vPis>
            <vCofins>53.00</vCofins>
            <tpRetPisCofins>1</tpRetPisCofins>
          </piscofins>
        </tribFed>
        <tribMun>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
      </trib>
    </valores>
  </infNFSe>
</NFSe>`;

    const leitura = service.extractLeituraFiscal(xml);
    const retencoes = service.extractRetentionAlertData(xml);
    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42076502246555046000178000000000042626088527978389'
    });
    const content = pdf.toString('latin1');

    expect(leitura.layout).toBe('padrao_nacional');
    expect(leitura.retencaoFederal).toBe('Retido');
    expect(leitura.totalRetencoesFederais).toBeUndefined();
    expect(retencoes.entries).toEqual([
      { code: 'pis', label: 'PIS retido' },
      { code: 'cofins', label: 'COFINS retido' }
    ]);
    expect(content).toContain('Tipo de Retencao PIS/COFINS/CSLL');
    expect(content).toContain('PIS/COFINS retidos');
    expect(content).toContain('PIS - Debito Apuracao Propria');
    expect(content).toContain('COFINS - Debito Apuracao Propria');
  });

  it('interpreta tpRetISSQN=1 do layout nacional como nao retido quando nao houver valor de ISS retido', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS42076502246555046000178000000000042626080527978389">
    <xLocPrestacao>Iporã do Oeste</xLocPrestacao>
    <xLocIncid>Iporã do Oeste</xLocIncid>
    <nNFSe>426</nNFSe>
    <valores>
      <vLiq>2000.00</vLiq>
      <vISSQN>100.00</vISSQN>
      <trib>
        <tribMun>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
      </trib>
    </valores>
    <DPS>
      <infDPS>
        <prest>
          <regTrib>
            <opSimpNac>3</opSimpNac>
          </regTrib>
        </prest>
        <valores>
          <vServPrest>
            <vServ>2000.00</vServ>
          </vServPrest>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

    const leitura = service.extractLeituraFiscal(xml);
    const retencoes = service.extractRetentionAlertData(xml);
    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42076502246555046000178000000000042626080527978389'
    });
    const content = pdf.toString('latin1');

    expect(leitura.layout).toBe('padrao_nacional');
    expect(leitura.retencaoIss).toBe('Nao Retido');
    expect(retencoes.hasRetention).toBe(false);
    expect(retencoes.entries).toEqual([]);
    expect(content).toContain('Optante - ME/EPP');
    expect(content).toContain('Nao Retido');
  });

  it('sinaliza erro de leitura quando ha retencoes com valor de servico zerado', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>64</Numero>
      <ValoresNfse>
        <ValorLiquidoNfse>95.00</ValorLiquidoNfse>
      </ValoresNfse>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Servico>
            <Valores>
              <ValorServicos>0.00</ValorServicos>
              <ValorIssRetido>5.00</ValorIssRetido>
              <ValorIss>5.00</ValorIss>
            </Valores>
            <IssRetido>1</IssRetido>
          </Servico>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    const leitura = service.extractLeituraFiscal(xml);

    expect(leitura.layout).toBe('abrasf');
    expect(leitura.statusProcessamento).toBe('Erro');
    expect(leitura.erroProcessamento).toContain('Divisao por zero evitada');
    expect(leitura.camposComProblema).toEqual(['Valor Servico', 'ISS Retido Real', 'ISS']);
  });

  it('nao marca retencao federal em ABRASF quando o liquido reflete somente o ISS retido', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>899</Numero>
      <DataEmissao>2026-07-28T08:14:45-03:00</DataEmissao>
      <ValoresNfse>
        <BaseCalculo>10800.00</BaseCalculo>
        <Aliquota>3.00</Aliquota>
        <ValorIss>324.00</ValorIss>
        <ValorLiquidoNfse>10476.00</ValorLiquidoNfse>
      </ValoresNfse>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Servico>
            <Valores>
              <ValorServicos>10800.00</ValorServicos>
              <ValorIssRetido>324.00</ValorIssRetido>
              <ValorPis>178.20</ValorPis>
              <ValorCofins>820.80</ValorCofins>
              <OutrasRetencoes>324.00</OutrasRetencoes>
              <ValorIss>324.00</ValorIss>
            </Valores>
            <IssRetido>1</IssRetido>
          </Servico>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    const leitura = service.extractLeituraFiscal(xml);
    const retencoes = service.extractRetentionAlertData(xml);

    expect(leitura.layout).toBe('abrasf');
    expect(leitura.valorTotalRetencoes).toBe('324.00');
    expect(leitura.valorIssRetidoReal).toBe('324.00');
    expect(leitura.retencaoIss).toBe('Retido');
    expect(leitura.retencaoFederal).toBe('Normal');
    expect(leitura.totalRetencoesFederais).toBe('0.00');
    expect(retencoes.entries).toEqual([{ code: 'iss', label: 'ISS retido' }]);
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

  it('prioriza o valor de ISS retido quando o codigo de retencao vier inconsistente no XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>798</Numero>
      <CodigoVerificacao>42134012219893422000161000000000079826079564386937</CodigoVerificacao>
      <DataEmissao>2026-07-31T10:15:00-03:00</DataEmissao>
      <ValoresNfse>
        <BaseCalculo>12600.00</BaseCalculo>
        <Aliquota>3.00</Aliquota>
        <ValorIss>378.00</ValorIss>
        <ValorIssRetido>378.00</ValorIssRetido>
      </ValoresNfse>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj>
            <Cnpj>19893422000161</Cnpj>
          </CpfCnpj>
        </IdentificacaoPrestador>
        <RazaoSocial>Prestador Exemplo LTDA</RazaoSocial>
      </PrestadorServico>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Competencia>2026-07-31T00:00:00</Competencia>
          <Servico>
            <Valores>
              <ValorServicos>12600.00</ValorServicos>
              <ValorIss>378.00</ValorIss>
              <ValorIssRetido>378.00</ValorIssRetido>
            </Valores>
            <IssRetido>1</IssRetido>
            <Discriminacao>Servico com ISS retido no tomador</Discriminacao>
          </Servico>
          <Tomador>
            <IdentificacaoTomador>
              <CpfCnpj>
                <Cnpj>00000000000191</Cnpj>
              </CpfCnpj>
            </IdentificacaoTomador>
            <RazaoSocial>Tomador Exemplo SA</RazaoSocial>
          </Tomador>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42134012219893422000161000000000079826079564386937'
    });

    const content = pdf.toString('latin1');

    expect(content).toContain('Retencao do ISSQN');
    expect(content).toContain('Retido');
    expect(content).toContain('ISSQN Retido');
    expect(content).toContain('R$ 378,00');
  });

  it('interpreta IssRetido=1 como retido mesmo sem ValorIssRetido informado', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="1.00">
    <InfNfse>
      <Numero>799</Numero>
      <CodigoVerificacao>42134012219893422000161000000000079926079564386938</CodigoVerificacao>
      <DataEmissao>2026-07-31T10:20:00-03:00</DataEmissao>
      <ValoresNfse>
        <BaseCalculo>1000.00</BaseCalculo>
        <Aliquota>3.00</Aliquota>
        <ValorIss>30.00</ValorIss>
      </ValoresNfse>
      <DeclaracaoPrestacaoServico>
        <InfDeclaracaoPrestacaoServico>
          <Servico>
            <Valores>
              <ValorServicos>1000.00</ValorServicos>
              <ValorIss>30.00</ValorIss>
            </Valores>
            <IssRetido>1</IssRetido>
            <Discriminacao>Servico com codigo de ISS retido</Discriminacao>
          </Servico>
        </InfDeclaracaoPrestacaoServico>
      </DeclaracaoPrestacaoServico>
    </InfNfse>
  </Nfse>
</CompNfse>`;

    const pdf = service.generateFromXml(xml, {
      chaveAcesso: '42134012219893422000161000000000079926079564386938'
    });

    const content = pdf.toString('latin1');

    expect(content).toContain('Retencao do ISSQN');
    expect(content).toContain('Retido');
  });
});
