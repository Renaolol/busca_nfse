import { Injectable } from '@nestjs/common';
import { NfeAmbiente } from '@prisma/client';
import { CteConsultaClient, CteConsultaResult } from './cte-consulta.types';

@Injectable()
export class FakeCteConsultaClient implements CteConsultaClient {
  async consultarPorChave(params: {
    chaveAcesso: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<CteConsultaResult> {
    const summaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<retConsSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <tpAmb>${params.ambiente === NfeAmbiente.producao ? '1' : '2'}</tpAmb>
  <cStat>100</cStat>
  <xMotivo>Autorizado o uso do CT-e</xMotivo>
  <chCTe>${params.chaveAcesso}</chCTe>
  <protCTe>
    <infProt>
      <chCTe>${params.chaveAcesso}</chCTe>
      <dhRecbto>2026-07-15T10:00:01-03:00</dhRecbto>
      <xMotivo>Autorizado o uso do CT-e</xMotivo>
    </infProt>
  </protCTe>
</retConsSitCTe>`;
    const eventXml = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID110111${params.chaveAcesso}01">
      <tpEvento>110111</tpEvento>
      <chCTe>${params.chaveAcesso}</chCTe>
      <dhEvento>2026-07-15T11:00:00-03:00</dhEvento>
      <detEvento versaoEvento="4.00">
        <evCancCTe>
          <descEvento>Cancelamento</descEvento>
        </evCancCTe>
      </detEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`;

    return {
      statusCode: 200,
      cStat: '100',
      xMotivo: 'CT-e localizado por chave',
      documents: [
        {
          schema: 'retConsSitCTe_v4.00',
          xml: summaryXml,
          chaveAcesso: params.chaveAcesso
        },
        {
          schema: 'procEventoCTe_v4.00',
          xml: eventXml,
          chaveAcesso: params.chaveAcesso
        }
      ],
      rawResponse: {
        mock: true,
        ambiente: params.ambiente,
        certificateId: params.certificateId
      }
    };
  }
}
