import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { RealNfceScClient } from '../real-nfce-sc.client';

jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

describe('RealNfceScClient', () => {
  afterEach(() => jest.clearAllMocks());

  it('converte para PEM quando o Node rejeita um PFX legado', async () => {
    const pfx = Buffer.from('fake-pfx');
    const cert = '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----';
    const key = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----';
    (spawnSync as unknown as jest.Mock).mockImplementation((_command: string, args: string[]) => ({
      status: args.includes('-legacy') ? 0 : 1,
      stdout: args.includes('-legacy') ? (args.includes('-nokeys') ? cert : key) : '',
      stderr: args.includes('-legacy') ? '' : 'unsupported PFX algorithm',
      error: undefined
    }));

    const requestMock = httpsRequest as unknown as jest.Mock;
    requestMock.mockImplementation((_url: string, options: Record<string, unknown>, callback: (response: EventEmitter & { statusCode: number }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
      req.end = jest.fn(() => {
        if (options.pfx) {
          process.nextTick(() => req.emit('error', new Error('Unsupported PKCS12 PFX data')));
          return;
        }

        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = 200;
        process.nextTick(() => {
          callback(response);
          response.emit('data', '<nfceDownloadContabResult><cStat>117</cStat><xMotivo>OK</xMotivo><ultNuNSURet>0</ultNuNSURet></nfceDownloadContabResult>');
          response.emit('end');
        });
      });
      return req;
    });

    const client = new RealNfceScClient(
      { certificado: { findUnique: jest.fn().mockResolvedValue({
        id: 'certificate-id',
        ativo: true,
        validadeFim: null,
        arquivoCriptografadoPath: 'certificate.bin',
        senhaCriptografada: 'encrypted-password'
      }) } } as never,
      { getObject: jest.fn().mockResolvedValue(Buffer.from('encrypted-pfx')) } as never,
      { decrypt: jest.fn((value: string) => Buffer.from(value === 'encrypted-pfx' ? pfx : 'secret')) } as never
    );

    const result = await client.download({
      clienteId: 'client-id',
      cnpjConsulta: '12345678000199',
      certificadoId: 'certificate-id',
      ambiente: 'producao' as never,
      ultimoNsu: 0n,
      indAtor: 1
    });

    expect(result.cStat).toBe('117');
    expect(result.errorDiagnostic).toBeUndefined();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[0][1]).toMatchObject({ pfx, passphrase: 'secret' });
    expect(requestMock.mock.calls[1][1]).toMatchObject({ cert, key });
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(spawnSync).toHaveBeenLastCalledWith(
      'openssl',
      expect.arrayContaining(['-legacy', '-nocerts', '-nodes']),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('retorna os envelopes SOAP brutos somente para cStat 9999', async () => {
    const requestMock = httpsRequest as unknown as jest.Mock;
    const responseXml = '<soap:Envelope><soap:Body><nfceDownloadContabResponse><nfceDownloadContabResult><retDistNFCeSC><cStat>9999</cStat><xMotivo>Erro interno. Código do erro: exemplo</xMotivo><ultNuNSURet>0</ultNuNSURet></retDistNFCeSC></nfceDownloadContabResult></nfceDownloadContabResponse></soap:Body></soap:Envelope>';
    let sentEnvelope = '';
    requestMock.mockImplementation((_url: string, _options: Record<string, unknown>, callback: (response: EventEmitter & { statusCode: number }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: jest.Mock };
      req.end = jest.fn((envelope: string) => {
        sentEnvelope = envelope;
        process.nextTick(() => {
          const response = new EventEmitter() as EventEmitter & { statusCode: number };
          response.statusCode = 200;
          callback(response);
          response.emit('data', responseXml);
          response.emit('end');
        });
      });
      return req;
    });

    const client = new RealNfceScClient(
      { certificado: { findUnique: jest.fn().mockResolvedValue({
        id: 'certificate-id',
        ativo: true,
        validadeFim: null,
        arquivoCriptografadoPath: 'certificate.bin',
        senhaCriptografada: 'encrypted-password'
      }) } } as never,
      { getObject: jest.fn().mockResolvedValue(Buffer.from('encrypted-pfx')) } as never,
      { decrypt: jest.fn((value: string) => Buffer.from(value === 'encrypted-pfx' ? 'fake-pfx' : 'secret')) } as never
    );

    const result = await client.download({
      clienteId: 'client-id',
      cnpjConsulta: '12345678000199',
      certificadoId: 'certificate-id',
      ambiente: 'producao' as never,
      ultimoNsu: 0n,
      indAtor: 1
    });

    expect(result.cStat).toBe('9999');
    expect(result.errorDiagnostic).toEqual({ requestXml: sentEnvelope, responseXml });
    expect(sentEnvelope).toContain('<ultNuNSU>0</ultNuNSU>');
    expect(sentEnvelope).toContain('<CNPJ>12345678000199</CNPJ>');
  });
});
