import { RealNfseAdnClient } from '../real-nfse-adn.client';

describe('RealNfseAdnClient', () => {
  it('extrai todos os documentos retornados em LoteDFe', () => {
    const client = new RealNfseAdnClient({} as never, {} as never, {} as never) as unknown as {
      extractDfeDocuments(payload: Record<string, unknown>): Array<{
        nsu?: bigint;
        xml: string;
        chaveAcesso?: string;
      }>;
    };

    const documents = client.extractDfeDocuments({
      LoteDFe: [
        {
          NSU: '9',
          ChaveAcesso: 'chave-333',
          xml: '<NFSe>333</NFSe>'
        },
        {
          NSU: '10',
          ChaveAcesso: 'chave-334',
          xml: '<NFSe>334</NFSe>'
        },
        {
          NSU: '11',
          ChaveAcesso: 'chave-335',
          xml: '<NFSe>335</NFSe>'
        }
      ]
    });

    expect(documents).toEqual([
      {
        nsu: 9n,
        chaveAcesso: 'chave-333',
        xml: '<NFSe>333</NFSe>'
      },
      {
        nsu: 10n,
        chaveAcesso: 'chave-334',
        xml: '<NFSe>334</NFSe>'
      },
      {
        nsu: 11n,
        chaveAcesso: 'chave-335',
        xml: '<NFSe>335</NFSe>'
      }
    ]);
  });

  it('normaliza erro de cadeia TLS autoassinada com mensagem orientativa', () => {
    const client = new RealNfseAdnClient({} as never, {} as never, {} as never) as unknown as {
      normalizeAdnQueryErrorMessage(error: unknown): string;
    };

    const message = client.normalizeAdnQueryErrorMessage(
      new Error('self-signed certificate in certificate chain')
    );

    expect(message).toContain('Falha na validacao TLS da API ADN');
    expect(message).toContain('proxy');
  });
});
