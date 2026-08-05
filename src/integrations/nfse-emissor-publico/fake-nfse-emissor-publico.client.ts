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

  async getDpsById(params: {
    dpsId: string;
    ambiente: NfseAmbiente;
    certificateId: string;
  }): Promise<NfseEmissorPublicoDpsResult> {
    const numero = params.dpsId.replace(/\D/g, '').slice(-12).replace(/^0+/, '') || '1';
    const chaveAcesso = `421100900000000000000000000000${numero.padStart(6, '0')}26080512345678`.slice(0, 50);
    const nfse = await this.getNfseByChave({
      chaveAcesso,
      ambiente: params.ambiente,
      certificateId: params.certificateId
    });

    return {
      statusCode: nfse.statusCode,
      dpsId: params.dpsId,
      chaveAcesso,
      xml: nfse.xml,
      rawResponse: {
        mock: true,
        certificateId: params.certificateId
      },
      message: nfse.message
    };
  }
}
