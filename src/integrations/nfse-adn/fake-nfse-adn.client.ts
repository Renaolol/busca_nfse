import { Injectable } from '@nestjs/common';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import { AdnDFeResult, NfseAdnClient } from './nfse-adn.types';

@Injectable()
export class FakeNfseAdnClient implements NfseAdnClient {
  async getDFeByNsu(params: {
    cnpjConsulta: string;
    nsu: bigint;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<AdnDFeResult> {
    const hasDocument = params.nsu % 5n === 0n;

    if (!hasDocument) {
      return {
        nsu: params.nsu,
        hasDocument: false,
        rawResponse: { message: 'Sem documento para o NSU' },
        statusCode: 404,
        message: 'Sem documento para o NSU informado'
      };
    }

    const chave = `${params.cnpjConsulta}${String(params.nsu).padStart(14, '0')}`.slice(0, 44);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<NFSe>\n  <infNFSe>\n    <chaveAcesso>${chave}</chaveAcesso>\n    <numeroNFSe>${params.nsu}</numeroNFSe>\n    <dataEmissao>${new Date().toISOString()}</dataEmissao>\n    <prestador>\n      <cnpj>${params.cnpjConsulta}</cnpj>\n      <razaoSocial>Prestador Exemplo</razaoSocial>\n    </prestador>\n    <tomador>\n      <cnpj>00000000000000</cnpj>\n      <razaoSocial>Tomador Exemplo</razaoSocial>\n    </tomador>\n    <valorServico>100.00</valorServico>\n  </infNFSe>\n</NFSe>`;

    return {
      nsu: params.nsu,
      hasDocument: true,
      xml,
      chaveAcesso: chave,
      rawResponse: { mock: true },
      statusCode: 200
    };
  }

  async getEventosByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<unknown> {
    return {
      chaveAcesso: params.chaveAcesso,
      ambiente: params.ambiente,
      eventos: []
    };
  }
}
