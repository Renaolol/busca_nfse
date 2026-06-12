import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Certificado } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { PrismaService } from '../../../prisma/prisma.service';
import { CertificatesService } from '../certificates.service';
import { CreateCertificateDto } from '../dto/create-certificate.dto';
import { CryptoService } from '../../shared/crypto.service';
import { LocalStorageService } from '../../storage/storage.service';

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn()
}));

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

const SAMPLE_PEM_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIH0zCCBbugAwIBAgIIXsO3pkN/pOAwDQYJKoZIhvcNAQEFBQAwQjESMBAGA1UE
AwwJQUNDVlJBSVoxMRAwDgYDVQQLDAdQS0lBQ0NWMQ0wCwYDVQQKDARBQ0NWMQsw
CQYDVQQGEwJFUzAeFw0xMTA1MDUwOTM3MzdaFw0zMDEyMzEwOTM3MzdaMEIxEjAQ
BgNVBAMMCUFDQ1ZSQUlaMTEQMA4GA1UECwwHUEtJQUNDVjENMAsGA1UECgwEQUND
VjELMAkGA1UEBhMCRVMwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCb
qau/YUqXry+XZpp0X9DZlv3P4uRm7x8fRzPCRKPfmt4ftVTdFXxpNRFvu8gMjmoY
HtiP2Ra8EEg2XPBjs5BaXCQ316PWywlxufEBcoSwfdtNgM3802/J+Nq2DoLSRYWo
G2ioPej0RGy9ocLLA76MPhMAhN9KSMDjIgro6TenGEyxCQ0jVn8ETdkXhBilyNpA
lHPrzg5XPAOBOp0KoVdDaaxXbXmQeOW1tDvYvEyNKKGno6e6Ak4l0Squ7a4DIrhr
IA8wKFSVf+DuzgpmndFALW4ir50awQUZ0m/A8p/4e7MCQvtQqR0tkw8jq8bBD5L/
0KIV9VMJcRz/RROE5iZe+OCIHAr8Fraocwa48GOEAqDGWuzndN9wrqODJerWx5eH
k6fGioozl2A3ED6XPm4pFdahD9GILBKfb6qkxkLrQaLjlUPTAYVtjrs78yM2x/47
4KElB0iryYl0/wiPgL/AlmXz7uxLaL2diMMxs0Dx6M/2OLuc5NF/1OVYm3z61PMO
m3WR5LpSLhl+0fXNWhn8ugb2+1KoS5kE3fj5tItQo05iifCHJPqDQsGH+tUtKSpa
cXpkatcnYGMN285J9Y0fkIkyF/hzQ7jSWpOGYdbhdQrqeWZ2iE9x6wQl1gpaepPl
uUsXQA+xtrn13k/c4LOsOxFwYIRKQ26ZIMApcQrAZQIDAQABo4ICyzCCAscwfQYI
KwYBBQUHAQEEcTBvMEwGCCsGAQUFBzAChkBodHRwOi8vd3d3LmFjY3YuZXMvZmls
ZWFkbWluL0FyY2hpdm9zL2NlcnRpZmljYWRvcy9yYWl6YWNjdjEuY3J0MB8GCCsG
AQUFBzABhhNodHRwOi8vb2NzcC5hY2N2LmVzMB0GA1UdDgQWBBTSh7Tj3zcnk1X2
VuqB5TbMjB4/vTAPBgNVHRMBAf8EBTADAQH/MB8GA1UdIwQYMBaAFNKHtOPfNyeT
VfZW6oHlNsyMHj+9MIIBcwYDVR0gBIIBajCCAWYwggFiBgRVHSAAMIIBWDCCASIG
CCsGAQUFBwICMIIBFB6CARAAQQB1AHQAbwByAGkAZABhAGQAIABkAGUAIABDAGUA
cgB0AGkAZgBpAGMAYQBjAGkA8wBuACAAUgBhAO0AegAgAGQAZQAgAGwAYQAgAEEA
QwBDAFYAIAAoAEEAZwBlAG4AYwBpAGEAIABkAGUAIABUAGUAYwBuAG8AbABvAGcA
7QBhACAAeQAgAEMAZQByAHQAaQBmAGkAYwBhAGMAaQDzAG4AIABFAGwAZQBjAHQA
cgDzAG4AaQBjAGEALAAgAEMASQBGACAAUQA0ADYAMAAxADEANQA2AEUAKQAuACAA
QwBQAFMAIABlAG4AIABoAHQAdABwADoALwAvAHcAdwB3AC4AYQBjAGMAdgAuAGUA
czAwBggrBgEFBQcCARYkaHR0cDovL3d3dy5hY2N2LmVzL2xlZ2lzbGFjaW9uX2Mu
aHRtMFUGA1UdHwROMEwwSqBIoEaGRGh0dHA6Ly93d3cuYWNjdi5lcy9maWxlYWRt
aW4vQXJjaGl2b3MvY2VydGlmaWNhZG9zL3JhaXphY2N2MV9kZXIuY3JsMA4GA1Ud
DwEB/wQEAwIBBjAXBgNVHREEEDAOgQxhY2N2QGFjY3YuZXMwDQYJKoZIhvcNAQEF
BQADggIBAJcxAp/n/UNnSEQU5CmH7UwoZtCPNdpNYbdKl02125DgBS4OxnnQ8pdp
D70ER9m+27Up2pvZrqmZ1dM8MJP1jaGo/AaNRPTKFpV8M9xii6g3+CfYCS0b78gU
JyCpZET/LtZ1qmxNYEAZSUNUY9rizLpm5U9EelvZaoErQNV/+QEnWCzI7UiRfD+m
AM/EKXMRNt6GGT6d7hmKG9Ww7Y49nCrADdg9ZuM8Db3VlFzi4qc1GwQA9j9ajepD
vV+JHanBsMyZ4k0ACtrJJ1vnE5Bc5PUzolVt3OAJTS+xJlsndQAJxGJ3KQhfnlms
tn6tn1QwIgPBHnFk/vk4CpYY3QIUrCPLBhwepH2NDd4nQeit2hW3sCPdK6jT2iWH
7ehVRE2I9DZ+hJp4rPcOVkkO1jMl1oRQQmwgEh0q1b688nCBpHBgvgW1m54ERL5h
I6zppSSMEYCUWqKiuUnSwdzRp+0xESyeGabu4VXhwOrPDYTkF7eifKXeVSUG7szA
h1xA2syVP1XgNce4hL60Xc16gwFy7ofmXx2utYXGJt/mwZrpHgJHnyqobalbz+xF
d3+YJ5oyXSrjhO7FmGYvliAd3djDJ9ew+f7Zfc3Qn48LFFhRny+Lwzgt3uiP1o2H
pPVWQxaZLPSkVrQ0uGE3ycJYgBugl6H8WY3pEfbRD0tVNEYqi4Y7
-----END CERTIFICATE-----`;

type PrismaMock = {
  cliente: { findUnique: jest.Mock };
  clienteEstabelecimento: { findUnique: jest.Mock };
  certificado: {
    update: jest.Mock;
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
};

describe('CertificatesService', () => {
  let service: CertificatesService;
  let prisma: PrismaMock;
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };
  let storage: { putObject: jest.Mock; getObject: jest.Mock; deleteObject: jest.Mock };

  beforeEach(() => {
    prisma = {
      cliente: { findUnique: jest.fn().mockResolvedValue({ id: 'cliente-1' }) },
      clienteEstabelecimento: {
        findUnique: jest.fn().mockResolvedValue({ id: 'estab-1', clienteId: 'cliente-1' })
      },
      certificado: {
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined)
      }
    };

    crypto = {
      encrypt: jest.fn((input: Buffer | string) =>
        Buffer.isBuffer(input) ? `enc:${input.toString('base64')}` : `enc:${input}`
      ),
      decrypt: jest.fn((input: string) => Buffer.from(`dec:${input}`))
    };

    storage = {
      putObject: jest.fn().mockResolvedValue('/tmp/storage/certificado.bin'),
      getObject: jest.fn().mockResolvedValue(Buffer.from('enc:certificado')),
      deleteObject: jest.fn().mockResolvedValue(undefined)
    };

    service = new CertificatesService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      storage as unknown as LocalStorageService
    );
    mockedSpawnSync.mockReset();
  });

  it('preenche validade automaticamente a partir do certificado', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 123,
      output: [null, `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`, ''],
      stdout: `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`,
      stderr: '',
      status: 0,
      signal: null
    } as ReturnType<typeof spawnSync>);

    prisma.certificado.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildCertificateRecord(data))
    );

    const dto: CreateCertificateDto = {
      nome: 'Certificado Principal',
      cnpjTitular: '12345678000199',
      estabelecimentoId: 'estab-1',
      arquivoBase64: Buffer.from('conteudo-pfx-fake').toString('base64'),
      senha: 'senha-certificado',
      validadeInicio: new Date('2000-01-01T00:00:00.000Z'),
      validadeFim: new Date('2001-01-01T00:00:00.000Z')
    };

    const created = await service.create('cliente-1', dto);
    const createPayload = prisma.certificado.create.mock.calls[0][0].data as Record<string, unknown>;

    expect(createPayload.validadeInicio).toBeInstanceOf(Date);
    expect(createPayload.validadeFim).toBeInstanceOf(Date);
    expect(createPayload.validadeInicio).not.toEqual(dto.validadeInicio);
    expect(createPayload.validadeFim).not.toEqual(dto.validadeFim);
    expect(createPayload.subject).toBeTruthy();
    expect(createPayload.emissor).toBeTruthy();
    expect(createPayload.serialNumber).toBeTruthy();
    expect(createPayload.thumbprint).toBeTruthy();
    expect(created.validadeFim).toEqual(createPayload.validadeFim);
  });

  it('cadastra certificado sem cliente vinculado com anotacoes', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 124,
      output: [null, `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`, ''],
      stdout: `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`,
      stderr: '',
      status: 0,
      signal: null
    } as ReturnType<typeof spawnSync>);

    prisma.certificado.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildCertificateRecord(data))
    );

    const dto: CreateCertificateDto = {
      nome: 'Certificado Reserva',
      cnpjTitular: '12345678000199',
      arquivoBase64: Buffer.from('conteudo-pfx-fake').toString('base64'),
      senha: 'senha-certificado',
      anotacoes: 'Reserva sem vinculo inicial'
    };

    const created = await service.create(null, dto);
    const createPayload = prisma.certificado.create.mock.calls[0][0].data as Record<string, unknown>;

    expect(prisma.cliente.findUnique).not.toHaveBeenCalled();
    expect(createPayload.clienteId).toBeNull();
    expect(createPayload.estabelecimentoId).toBeUndefined();
    expect(createPayload.anotacoes).toBe('Reserva sem vinculo inicial');
    expect(storage.putObject.mock.calls[0][0]).toMatch(/^certificados\/sem-cliente\/.+\.bin$/);
    expect(created.clienteId).toBeNull();
    expect(created.anotacoes).toBe('Reserva sem vinculo inicial');
  });

  it('faz fallback sem -clcerts quando necessario para extrair certificado', async () => {
    mockedSpawnSync
      .mockReturnValueOnce({
        pid: 801,
        output: [null, '', 'Could not find client certificate'],
        stdout: '',
        stderr: 'Could not find client certificate',
        status: 1,
        signal: null
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        pid: 802,
        output: [null, '', 'Could not find client certificate'],
        stdout: '',
        stderr: 'Could not find client certificate',
        status: 1,
        signal: null
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        pid: 803,
        output: [null, `${SAMPLE_PEM_CERTIFICATE}\n`, ''],
        stdout: `${SAMPLE_PEM_CERTIFICATE}\n`,
        stderr: '',
        status: 0,
        signal: null
      } as ReturnType<typeof spawnSync>);

    prisma.certificado.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildCertificateRecord(data))
    );

    const dto: CreateCertificateDto = {
      nome: 'Certificado Principal',
      cnpjTitular: '12345678000199',
      estabelecimentoId: 'estab-1',
      arquivoBase64: Buffer.from('conteudo-pfx-fake').toString('base64'),
      senha: 'senha-certificado'
    };

    const created = await service.create('cliente-1', dto);
    expect(created.validadeFim).toBeInstanceOf(Date);
    expect(prisma.certificado.create).toHaveBeenCalledTimes(1);
  });

  it('falha quando nao consegue ler certificado com openssl', async () => {
    mockedSpawnSync
      .mockReturnValueOnce({
        pid: 321,
        output: [null, '', 'invalid password'],
        stdout: '',
        stderr: 'invalid password',
        status: 1,
        signal: null
      } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({
        pid: 322,
        output: [null, '', 'invalid password'],
        stdout: '',
        stderr: 'invalid password',
        status: 1,
        signal: null
      } as ReturnType<typeof spawnSync>);

    const dto: CreateCertificateDto = {
      nome: 'Certificado Principal',
      cnpjTitular: '12345678000199',
      estabelecimentoId: 'estab-1',
      arquivoBase64: Buffer.from('conteudo-pfx-fake').toString('base64'),
      senha: 'senha-incorreta'
    };

    await expect(service.create('cliente-1', dto)).rejects.toThrow(BadRequestException);
    expect(prisma.certificado.create).not.toHaveBeenCalled();
  });

  it('falha com mensagem explicita quando openssl nao esta instalado', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 500,
      output: [null, '', ''],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: {
        name: 'Error',
        message: 'spawnSync openssl ENOENT',
        code: 'ENOENT'
      }
    } as ReturnType<typeof spawnSync>);

    const dto: CreateCertificateDto = {
      nome: 'Certificado Principal',
      cnpjTitular: '12345678000199',
      estabelecimentoId: 'estab-1',
      arquivoBase64: Buffer.from('conteudo-pfx-fake').toString('base64'),
      senha: 'senha-incorreta'
    };

    await expect(service.create('cliente-1', dto)).rejects.toThrow(InternalServerErrorException);
    expect(prisma.certificado.create).not.toHaveBeenCalled();
  });

  it('exclui certificado inativo', async () => {
    const certificate = buildCertificateRecord(
      {
        id: 'cert-inativo',
        clienteId: 'cliente-1',
        estabelecimentoId: 'estab-1',
        nome: 'Certificado Inativo',
        cnpjTitular: '12345678000199',
        tipo: 'A1',
        arquivoCriptografadoPath: 'certificados/cliente-1/cert-inativo.bin',
        senhaCriptografada: 'enc:senha'
      },
      { ativo: false }
    );

    prisma.certificado.findUnique.mockResolvedValue(certificate);

    const result = await service.remove('cert-inativo', 'cliente-1');

    expect(prisma.certificado.delete).toHaveBeenCalledWith({ where: { id: 'cert-inativo' } });
    expect(storage.deleteObject).toHaveBeenCalledWith('certificados/cliente-1/cert-inativo.bin');
    expect(result).toEqual({ id: 'cert-inativo', removido: true });
  });

  it('bloqueia exclusao de certificado ativo', async () => {
    const certificate = buildCertificateRecord({
      id: 'cert-ativo',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nome: 'Certificado Ativo',
      cnpjTitular: '12345678000199',
      tipo: 'A1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-ativo.bin',
      senhaCriptografada: 'enc:senha'
    });

    prisma.certificado.findUnique.mockResolvedValue(certificate);

    await expect(service.remove('cert-ativo', 'cliente-1')).rejects.toThrow(BadRequestException);
    expect(prisma.certificado.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('bloqueia operacao quando certificado nao pertence ao cliente informado', async () => {
    const certificate = buildCertificateRecord(
      {
        id: 'cert-outro-cliente',
        clienteId: 'cliente-2',
        estabelecimentoId: 'estab-2',
        nome: 'Certificado Outro Cliente',
        cnpjTitular: '12345678000199',
        tipo: 'A1',
        arquivoCriptografadoPath: 'certificados/cliente-2/cert-outro-cliente.bin',
        senhaCriptografada: 'enc:senha'
      },
      { ativo: false }
    );

    prisma.certificado.findUnique.mockResolvedValue(certificate);

    await expect(service.remove('cert-outro-cliente', 'cliente-1')).rejects.toThrow('Certificado nao encontrado');
    expect(prisma.certificado.delete).not.toHaveBeenCalled();
  });

  it('atualiza anotacoes de certificado avulso sem exigir clienteId', async () => {
    const certificate = buildCertificateRecord(
      {
        id: 'cert-avulso',
        clienteId: null,
        nome: 'Certificado Avulso',
        cnpjTitular: '12345678000199',
        tipo: 'A1',
        arquivoCriptografadoPath: 'certificados/sem-cliente/cert-avulso.bin',
        senhaCriptografada: 'enc:senha'
      },
      { ativo: false }
    );

    prisma.certificado.findUnique.mockResolvedValue(certificate);
    prisma.certificado.update.mockResolvedValue({
      ...certificate,
      anotacoes: 'Uso futuro'
    });

    const result = await service.updateNotes('cert-avulso', 'Uso futuro');

    expect(prisma.certificado.update).toHaveBeenCalledWith({
      where: { id: 'cert-avulso' },
      data: { anotacoes: 'Uso futuro' }
    });
    expect(result.anotacoes).toBe('Uso futuro');
  });

  it('atualiza dados cadastrais e vinculo sem trocar arquivo ou senha', async () => {
    const certificate = buildCertificateRecord({
      id: 'cert-edicao',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nome: 'Certificado Antigo',
      cnpjTitular: '12345678000199',
      tipo: 'A1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-edicao.bin',
      senhaCriptografada: 'enc:senha'
    });

    prisma.certificado.findUnique.mockResolvedValue(certificate);
    prisma.cliente.findUnique.mockResolvedValue({ id: 'cliente-2' });
    prisma.clienteEstabelecimento.findUnique.mockResolvedValue({ id: 'estab-2', clienteId: 'cliente-2' });
    prisma.certificado.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildCertificateRecord({ ...certificate, ...data }))
    );

    const result = await service.update(
      'cert-edicao',
      {
        clienteId: 'cliente-2',
        estabelecimentoId: 'estab-2',
        nome: 'Certificado Atualizado',
        cnpjTitular: '22345678000199',
        anotacoes: 'Editado pelo painel'
      },
      'cliente-1'
    );

    expect(prisma.certificado.update).toHaveBeenCalledWith({
      where: { id: 'cert-edicao' },
      data: {
        clienteId: 'cliente-2',
        estabelecimentoId: 'estab-2',
        nome: 'Certificado Atualizado',
        cnpjTitular: '22345678000199',
        anotacoes: 'Editado pelo painel'
      }
    });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(result.clienteId).toBe('cliente-2');
    expect(result.nome).toBe('Certificado Atualizado');
  });

  it('substitui arquivo e senha mantendo conteudo criptografado', async () => {
    mockedSpawnSync.mockReturnValue({
      pid: 910,
      output: [null, `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`, ''],
      stdout: `Bag Attributes\n${SAMPLE_PEM_CERTIFICATE}\n`,
      stderr: '',
      status: 0,
      signal: null
    } as ReturnType<typeof spawnSync>);

    const certificate = buildCertificateRecord({
      id: 'cert-arquivo',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nome: 'Certificado Arquivo',
      cnpjTitular: '12345678000199',
      tipo: 'A1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-arquivo.bin',
      senhaCriptografada: 'enc:senha-antiga'
    });

    prisma.certificado.findUnique.mockResolvedValue(certificate);
    prisma.certificado.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildCertificateRecord({ ...certificate, ...data }))
    );

    const result = await service.update(
      'cert-arquivo',
      {
        arquivoBase64: Buffer.from('novo-pfx-fake').toString('base64'),
        senha: 'senha-nova'
      },
      'cliente-1'
    );
    const updatePayload = prisma.certificado.update.mock.calls[0][0].data as Record<string, unknown>;

    expect(storage.putObject).toHaveBeenCalledWith('certificados/cliente-1/cert-arquivo.bin', `enc:${Buffer.from('novo-pfx-fake').toString('base64')}`);
    expect(updatePayload.senhaCriptografada).toBe('enc:senha-nova');
    expect(updatePayload.validadeInicio).toBeInstanceOf(Date);
    expect(updatePayload.validadeFim).toBeInstanceOf(Date);
    expect(updatePayload.arquivoCriptografadoPath).toBe('certificados/cliente-1/cert-arquivo.bin');
    expect(result.senhaCriptografada).toBeUndefined();
  });

  it('bloqueia troca de arquivo sem senha nova', async () => {
    const certificate = buildCertificateRecord({
      id: 'cert-sem-senha',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nome: 'Certificado Sem Senha',
      cnpjTitular: '12345678000199',
      tipo: 'A1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-sem-senha.bin',
      senhaCriptografada: 'enc:senha-antiga'
    });

    prisma.certificado.findUnique.mockResolvedValue(certificate);

    await expect(
      service.update(
        'cert-sem-senha',
        {
          arquivoBase64: Buffer.from('novo-pfx-fake').toString('base64')
        },
        'cliente-1'
      )
    ).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.certificado.update).not.toHaveBeenCalled();
  });

  it('baixa certificado avulso descriptografando somente em memoria', async () => {
    const certificate = buildCertificateRecord(
      {
        id: 'cert-download',
        clienteId: null,
        nome: 'Certificado Download',
        cnpjTitular: '12345678000199',
        tipo: 'A1',
        arquivoCriptografadoPath: 'certificados/sem-cliente/cert-download.bin',
        senhaCriptografada: 'enc:senha'
      },
      { ativo: false }
    );

    prisma.certificado.findUnique.mockResolvedValue(certificate);
    storage.getObject.mockResolvedValue(Buffer.from('payload-criptografado'));
    crypto.decrypt.mockReturnValue(Buffer.from('pfx-original'));

    const result = await service.download('cert-download');

    expect(storage.getObject).toHaveBeenCalledWith('certificados/sem-cliente/cert-download.bin');
    expect(crypto.decrypt).toHaveBeenCalledWith('payload-criptografado');
    expect(result).toEqual({
      id: 'cert-download',
      fileName: 'certificado-download-cert-download.pfx',
      contentType: 'application/x-pkcs12',
      contentBase64: Buffer.from('pfx-original').toString('base64')
    });
  });

  it('desvincula certificado de cliente e deixa inativo', async () => {
    const certificate = buildCertificateRecord({
      id: 'cert-vinculado',
      clienteId: 'cliente-1',
      estabelecimentoId: 'estab-1',
      nome: 'Certificado Vinculado',
      cnpjTitular: '12345678000199',
      tipo: 'A1',
      arquivoCriptografadoPath: 'certificados/cliente-1/cert-vinculado.bin',
      senhaCriptografada: 'enc:senha'
    });

    prisma.certificado.findUnique.mockResolvedValue(certificate);
    prisma.certificado.update.mockResolvedValue({
      ...certificate,
      clienteId: null,
      estabelecimentoId: null,
      ativo: false
    });

    const result = await service.unlink('cert-vinculado', 'cliente-1');

    expect(prisma.certificado.update).toHaveBeenCalledWith({
      where: { id: 'cert-vinculado' },
      data: {
        clienteId: null,
        estabelecimentoId: null,
        ativo: false
      }
    });
    expect(result.clienteId).toBeNull();
    expect(result.ativo).toBe(false);
  });
});

function buildCertificateRecord(
  data: Record<string, unknown>,
  overrides: Partial<Certificado> = {}
): Certificado {
  return {
    id: data.id as string,
    clienteId: (data.clienteId as string | null | undefined) ?? null,
    estabelecimentoId: (data.estabelecimentoId as string | undefined) ?? null,
    nome: data.nome as string,
    cnpjTitular: data.cnpjTitular as string,
    tipo: data.tipo as string,
    arquivoCriptografadoPath: data.arquivoCriptografadoPath as string,
    senhaCriptografada: data.senhaCriptografada as string,
    validadeInicio: (data.validadeInicio as Date | undefined) ?? null,
    validadeFim: (data.validadeFim as Date | undefined) ?? null,
    thumbprint: (data.thumbprint as string | undefined) ?? null,
    serialNumber: (data.serialNumber as string | undefined) ?? null,
    emissor: (data.emissor as string | undefined) ?? null,
    subject: (data.subject as string | undefined) ?? null,
    anotacoes: (data.anotacoes as string | undefined) ?? null,
    ativo: true,
    substituidoPorCertificadoId: null,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    ...overrides
  };
}
