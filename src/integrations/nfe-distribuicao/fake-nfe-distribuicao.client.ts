import { Injectable } from '@nestjs/common';
import { NfeAmbiente } from '@prisma/client';
import { NfeDistribuicaoClient, NfeDistribuicaoResult } from './nfe-distribuicao.types';

@Injectable()
export class FakeNfeDistribuicaoClient implements NfeDistribuicaoClient {
  async distribuirPorNsu(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    ultNsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    const nextNsu = params.ultNsu + 1n;
    const maxNsu = nextNsu + 50n;
    const hasDocument = nextNsu % 5n !== 0n;

    if (!hasDocument) {
      return {
        statusCode: 200,
        cStat: '137',
        xMotivo: 'Nenhum documento localizado',
        ultNsu: nextNsu,
        maxNsu,
        documents: [],
        rawResponse: {
          mock: true,
          ambiente: params.ambiente,
          certificateId: params.certificateId
        }
      };
    }

    const chaveBase = `${params.cnpjConsulta}${String(nextNsu).padStart(30, '0')}`.replace(/\D/g, '');
    const chaveAcesso = chaveBase.slice(0, 44).padEnd(44, '0');
    const emitida = nextNsu % 2n !== 0n;
    const cnpjEmitente = emitida ? params.cnpjConsulta : '11222333000181';
    const cnpjDestinatario = emitida ? '99888777000166' : params.cnpjConsulta;
    const valorTotal = (100 + Number(nextNsu % 25n)).toFixed(2);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chaveAcesso}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <mod>55</mod>
        <serie>${String((Number(nextNsu % 9n) || 1)).padStart(3, '0')}</serie>
        <nNF>${Number(nextNsu)}</nNF>
        <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>${cnpjEmitente}</CNPJ>
        <xNome>${emitida ? 'Emitente Mock SA' : 'Fornecedor Mock LTDA'}</xNome>
      </emit>
      <dest>
        <CNPJ>${cnpjDestinatario}</CNPJ>
        <xNome>${emitida ? 'Cliente Mock LTDA' : 'Destinatario Mock SA'}</xNome>
      </dest>
      <total>
        <ICMSTot>
          <vNF>${valorTotal}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe>
    <infProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
      <dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto>
      <chNFe>${chaveAcesso}</chNFe>
    </infProt>
  </protNFe>
</nfeProc>`;

    return {
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documentos localizados',
      ultNsu: nextNsu,
      maxNsu,
      documents: [
        {
          nsu: nextNsu,
          schema: 'procNFe_v4.00',
          xml,
          chaveAcesso
        }
      ],
      rawResponse: {
        mock: true,
        ambiente: params.ambiente,
        certificateId: params.certificateId
      }
    };
  }

  async consultarPorNsu(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    nsu: bigint;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    const distributed = await this.distribuirPorNsu({
      cnpjConsulta: params.cnpjConsulta,
      cUfAutor: params.cUfAutor,
      ultNsu: params.nsu - 1n,
      ambiente: params.ambiente,
      certificateId: params.certificateId
    });

    return {
      ...distributed,
      ultNsu: params.nsu,
      maxNsu: distributed.maxNsu < params.nsu ? params.nsu : distributed.maxNsu
    };
  }

  async consultarPorChave(params: {
    cnpjConsulta: string;
    cUfAutor?: string;
    chaveAcesso: string;
    ambiente: NfeAmbiente;
    certificateId: string;
  }): Promise<NfeDistribuicaoResult> {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${params.chaveAcesso}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <mod>55</mod>
        <serie>001</serie>
        <nNF>123</nNF>
        <dhEmi>2026-06-29T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>${params.cnpjConsulta}</CNPJ>
        <xNome>Emitente Mock SA</xNome>
      </emit>
      <dest>
        <CNPJ>99888777000166</CNPJ>
        <xNome>Cliente Mock LTDA</xNome>
      </dest>
      <total>
        <ICMSTot>
          <vNF>150.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe>
    <infProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
      <dhRecbto>2026-06-29T10:00:01-03:00</dhRecbto>
      <chNFe>${params.chaveAcesso}</chNFe>
    </infProt>
  </protNFe>
</nfeProc>`;

    return {
      statusCode: 200,
      cStat: '138',
      xMotivo: 'Documento localizado por chave',
      ultNsu: 0n,
      maxNsu: 0n,
      documents: [
        {
          schema: 'procNFe_v4.00',
          xml,
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
