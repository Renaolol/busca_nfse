import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { request as httpsRequest } from 'node:https';
import { RealNfeScClient } from '../real-nfe-sc.client';

jest.mock('node:https', () => ({ request: jest.fn() }));

describe('RealNfeScClient', () => {
  afterEach(() => jest.clearAllMocks());

  it('monta pedido CPF/NSU e decodifica nfeProc de um lote gzip sem rede real', async () => {
    const nfeXml = '<nfeProc><NFe><infNFe Id="NFe41261012345678000199550010000001231000001231" /></NFe></nfeProc>';
    const batch = `<loteDistNFeSC versao="2.00"><distNFeSC NSU="8" chAcesso="41261012345678000199550010000001231000001231">${nfeXml}</distNFeSC></loteDistNFeSC>`;
    const compressed = gzipSync(Buffer.from(batch, 'utf8')).toString('base64');
    const responseXml = `<retDistNFeSC><cStat>118</cStat><xMotivo>DF-e localizados</xMotivo><ultNuNSURet>8</ultNuNSURet><qtDfeRet>1</qtDfeRet><loteDistComp>${compressed}</loteDistComp></retDistNFeSC>`;
    const escapedResult = responseXml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const responseBody = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><nfeDownloadContabResponse><nfeDownloadContabResult>${escapedResult}</nfeDownloadContabResult></nfeDownloadContabResponse></soap:Body></soap:Envelope>`;
    const requestMock = httpsRequest as unknown as jest.Mock;
    requestMock.mockImplementation((_url: string, options: Record<string, unknown>, callback: (response: EventEmitter & { statusCode: number }) => void) => {
      const request = new EventEmitter() as EventEmitter & { end: jest.Mock; destroy: jest.Mock };
      request.end = jest.fn(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = 200;
        process.nextTick(() => {
          callback(response);
          response.emit('data', responseBody);
          response.emit('end');
        });
      });
      request.destroy = jest.fn((error?: Error) => { if (error) request.emit('error', error); });
      (requestMock as any).lastOptions = options;
      return request;
    });

    const client = new RealNfeScClient(
      { certificado: { findUnique: jest.fn().mockResolvedValue({
        id: 'cert-1', clienteId: 'cliente-1', estabelecimentoId: 'estab-1', tipo: 'A1', ativo: true, validadeFim: null,
        arquivoCriptografadoPath: 'protected/cert.pfx', senhaCriptografada: 'encrypted-password'
      }) } } as never,
      { getObject: jest.fn().mockResolvedValue(Buffer.from('encrypted-pfx')) } as never,
      { decrypt: jest.fn((value: string) => Buffer.from(value === 'encrypted-pfx' ? 'fake-pfx' : 'fake-password')) } as never
    );

    const result = await client.download({
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      cpfConsulta: '52998224725',
      certificadoId: 'cert-1',
      ambiente: 'producao',
      ultimoNsu: 7n,
      indAtor: 1
    });

    expect(result).toMatchObject({ cStat: '118', ultimoNsu: 8n, httpStatus: 200 });
    expect(result.documentos).toEqual([{
      nsu: 8n,
      chaveAcesso: '41261012345678000199550010000001231000001231',
      schema: 'nfeProc_v4.00',
      xml: nfeXml
    }]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const options = (requestMock as any).lastOptions as Record<string, unknown>;
    expect(options).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    const requestOptions = requestMock.mock.calls[0][1] as Record<string, unknown>;
    expect(requestOptions).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    expect(requestMock.mock.calls[0][0]).toBe('https://satnfe.sef.sc.gov.br/ws/distribuicao/nfedownloadV2.asmx');
    const requestBody = (requestMock.mock.results[0].value as EventEmitter & { end: jest.Mock }).end.mock.calls;
    expect(requestBody[0][0]).toContain('<CPF>52998224725</CPF>');
    expect(requestBody[0][0]).toContain('<ultNuNSU>7</ultNuNSU>');
    expect(requestBody[0][0]).toContain('<indAtor>1</indAtor>');
  });

  it('recusa certificado fora do escopo antes de abrir uma requisicao TLS', async () => {
    const requestMock = httpsRequest as unknown as jest.Mock;
    const client = new RealNfeScClient(
      { certificado: { findUnique: jest.fn().mockResolvedValue({
        id: 'cert-1', clienteId: 'outro-cliente', estabelecimentoId: 'estab-1', tipo: 'A1', ativo: true, validadeFim: null,
        arquivoCriptografadoPath: 'protected/cert.pfx', senhaCriptografada: 'encrypted-password'
      }) } } as never,
      { getObject: jest.fn() } as never,
      { decrypt: jest.fn() } as never
    );

    await expect(client.download({
      clienteId: 'cliente-1', estabelecimentoId: 'estab-1', cpfConsulta: '52998224725', certificadoId: 'cert-1',
      ambiente: 'producao', ultimoNsu: 0n, indAtor: 3
    })).rejects.toThrow('Certificado fora do escopo do cliente');
    expect(requestMock).not.toHaveBeenCalled();
  });
});
