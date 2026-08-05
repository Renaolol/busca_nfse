import { Injectable } from '@nestjs/common';
import { NfseAmbiente } from '../../common/enums/nfse-ambiente.enum';
import {
  NfseEmissorPublicoClient,
  NfseEmissorPublicoDpsResult,
  NfseEmissorPublicoNfseResult
} from './nfse-emissor-publico.types';

@Injectable()
export class FakeNfseEmissorPublicoClient implements NfseEmissorPublicoClient {
  async getNfseByChave(params: {
    chaveAcesso: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoNfseResult> {
    const numero = params.chaveAcesso.slice(-10).replace(/^0+/, '') || '1';
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<NFSe>',
      '  <infNFSe>',
      `    <chaveAcesso>${params.chaveAcesso}</chaveAcesso>`,
      `    <numeroNFSe>${numero}</numeroNFSe>`,
      '    <serie>70000</serie>',
      `    <tpAmb>${params.ambiente === NfseAmbiente.PRODUCAO ? '1' : '2'}</tpAmb>`,
      `    <dataEmissao>${new Date().toISOString()}</dataEmissao>`,
      '    <prestador>',
      '      <cnpj>00000000000000</cnpj>',
      '      <razaoSocial>Prestador Emissor Publico Mock</razaoSocial>',
      '    </prestador>',
      '    <tomador>',
      '      <cnpj>11111111111111</cnpj>',
      '      <razaoSocial>Tomador Mock</razaoSocial>',
      '    </tomador>',
      '    <valorServico>100.00</valorServico>',
      '  </infNFSe>',
      '</NFSe>'
    ].join('\n');

    return {
      statusCode: 200,
      chaveAcesso: params.chaveAcesso,
      xml,
      rawResponse: {
        mock: true,
        certificateId: params.certificateId
      }
    };
  }

  async getNfseByDpsId(params: {
    dpsId: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoDpsResult> {
    const digits = params.dpsId.replace(/\D/g, '');
    const codigoMunicipio = digits.slice(0, 7) || '0000000';
    const cnpj = digits.slice(8, 22) || '00000000000000';
    const serie = digits.slice(22, 27).replace(/^0+/, '') || '1';
    const numero = digits.slice(27).replace(/^0+/, '') || '1';
    const chaveAcesso = `${codigoMunicipio}22${cnpj}${numero.padStart(13, '0')}2608${numero.padStart(9, '0')}1`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<NFSe>',
      '  <infNFSe>',
      `    <chaveAcesso>${chaveAcesso}</chaveAcesso>`,
      `    <numeroNFSe>${numero}</numeroNFSe>`,
      `    <serie>${serie}</serie>`,
      `    <tpAmb>${params.ambiente === NfseAmbiente.PRODUCAO ? '1' : '2'}</tpAmb>`,
      `    <dataEmissao>${new Date().toISOString()}</dataEmissao>`,
      '    <prestador>',
      `      <cnpj>${cnpj}</cnpj>`,
      '      <razaoSocial>Prestador Emissor Publico Mock</razaoSocial>',
      '    </prestador>',
      '    <tomador>',
      '      <cnpj>11111111111111</cnpj>',
      '      <razaoSocial>Tomador Mock</razaoSocial>',
      '    </tomador>',
      '    <valorServico>100.00</valorServico>',
      '  </infNFSe>',
      '</NFSe>'
    ].join('\n');

    return {
      statusCode: 200,
      dpsId: params.dpsId,
      xml,
      rawResponse: {
        mock: true,
        certificateId: params.certificateId
      }
    };
  }
}
