import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AuthGuard } from '../../src/modules/auth/auth.guard';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SimplesNacionalController } from '../../src/modules/simples-nacional/simples-nacional.controller';
import { SimplesNacionalService } from '../../src/modules/simples-nacional/simples-nacional.service';

describe('Simples Nacional (e2e)', () => {
  let app: INestApplication;

  const usuarios = {
    admin: { userId: 'u-admin', username: 'admin', role: 'admin', sessionId: 's-1', sessionExpiresAt: '' },
    comum: { userId: 'u-comum', username: 'comum', role: 'comum', sessionId: 's-2', sessionExpiresAt: '' },
    cliente: {
      userId: 'u-cliente',
      username: 'cliente',
      role: 'cliente',
      clienteId: '550e8400-e29b-41d4-a716-446655440000',
      sessionId: 's-3',
      sessionExpiresAt: ''
    }
  };

  const authService = {
    verifyAccessToken: jest.fn(async (token: string) => usuarios[token as keyof typeof usuarios]),
    registerAccessDenied: jest.fn().mockResolvedValue(undefined)
  };

  let bytesRecebidos = '';
  const simplesNacionalService = {
    getResumo: jest.fn().mockResolvedValue({ totalEmpresas: 0, ultimaImportacao: null, ultimaTentativa: null }),
    listEmpresas: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }),
    consultarCnpj: jest.fn().mockResolvedValue({ cnpj: '11222333000181', cnpjBase: '11222333', optante: true, empresa: null }),
    filtrarBasesOptantes: jest.fn().mockResolvedValue(['11222333']),
    iniciarImportacao: jest.fn(async (arquivo: Readable) => {
      const trechos: Buffer[] = [];
      for await (const trecho of arquivo) {
        trechos.push(Buffer.from(trecho));
      }
      bytesRecebidos = Buffer.concat(trechos).toString('utf-8');
      return { id: 'imp-1', status: 'processando' };
    }),
    limpar: jest.fn().mockResolvedValue({ removidas: 0 })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SimplesNacionalController],
      providers: [
        { provide: SimplesNacionalService, useValue: simplesNacionalService },
        { provide: AuthService, useValue: authService },
        { provide: APP_GUARD, useClass: AuthGuard }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    bytesRecebidos = '';
  });

  it('permite ao perfil comum consultar o resumo e um CNPJ', async () => {
    await request(app.getHttpServer()).get('/simples-nacional').set('Authorization', 'Bearer comum').expect(200);
    await request(app.getHttpServer())
      .get('/simples-nacional/empresas/11.222.333%2F0001-81')
      .set('Authorization', 'Bearer comum')
      .expect(200);

    expect(simplesNacionalService.consultarCnpj).toHaveBeenCalledWith('11.222.333/0001-81');
  });

  it('valida paginacao da listagem', async () => {
    await request(app.getHttpServer())
      .get('/simples-nacional/empresas')
      .query({ pageSize: 500 })
      .set('Authorization', 'Bearer admin')
      .expect(400);
    expect(simplesNacionalService.listEmpresas).not.toHaveBeenCalled();
  });

  it('bloqueia usuario de cliente na gestao da tabela do Simples Nacional', async () => {
    await request(app.getHttpServer()).get('/simples-nacional').set('Authorization', 'Bearer cliente').expect(403);
    expect(simplesNacionalService.getResumo).not.toHaveBeenCalled();
  });

  it('permite a consulta em lote para usuario de cliente (tela Armazenados)', async () => {
    const response = await request(app.getHttpServer())
      .post('/simples-nacional/consultas')
      .set('Authorization', 'Bearer cliente')
      .send({ cnpjs: ['11222333000181', '04252011000110'] })
      .expect(200);

    expect(response.body).toEqual({ cnpjBases: ['11222333'] });
    expect(simplesNacionalService.filtrarBasesOptantes).toHaveBeenCalledWith(['11222333000181', '04252011000110']);
  });

  it('limita a consulta em lote a 5000 CNPJs', async () => {
    await request(app.getHttpServer())
      .post('/simples-nacional/consultas')
      .set('Authorization', 'Bearer admin')
      .send({ cnpjs: Array.from({ length: 5001 }, () => '11222333000181') })
      .expect(400);
    expect(simplesNacionalService.filtrarBasesOptantes).not.toHaveBeenCalled();
  });

  it('restringe a importacao ao perfil admin', async () => {
    await request(app.getHttpServer())
      .post('/simples-nacional/importacoes')
      .query({ nomeArquivo: 'empresas.csv' })
      .set('Authorization', 'Bearer comum')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('CNPJ\n'))
      .expect(403);
    expect(simplesNacionalService.iniciarImportacao).not.toHaveBeenCalled();
  });

  it('exige o nome do arquivo na importacao', async () => {
    await request(app.getHttpServer())
      .post('/simples-nacional/importacoes')
      .set('Authorization', 'Bearer admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('CNPJ\n'))
      .expect(400);
    expect(simplesNacionalService.iniciarImportacao).not.toHaveBeenCalled();
  });

  it('recusa envio em JSON', async () => {
    await request(app.getHttpServer())
      .post('/simples-nacional/importacoes')
      .query({ nomeArquivo: 'empresas.csv' })
      .set('Authorization', 'Bearer admin')
      .send({ arquivoBase64: 'Q05QSgo=' })
      .expect(415);
    expect(simplesNacionalService.iniciarImportacao).not.toHaveBeenCalled();
  });

  it('repassa o arquivo bruto ao service e responde 202 enquanto processa', async () => {
    const response = await request(app.getHttpServer())
      .post('/simples-nacional/importacoes')
      .query({ nomeArquivo: 'Simples.zip' })
      .set('Authorization', 'Bearer admin')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('"11222333";"S";"20180101"\n'))
      .expect(202);

    expect(response.body).toEqual({ id: 'imp-1', status: 'processando' });
    expect(simplesNacionalService.iniciarImportacao).toHaveBeenCalledWith(expect.anything(), 'Simples.zip', usuarios.admin);
    expect(bytesRecebidos).toBe('"11222333";"S";"20180101"\n');
  });

  it('restringe a remocao da tabela ao perfil admin', async () => {
    await request(app.getHttpServer())
      .delete('/simples-nacional/empresas')
      .set('Authorization', 'Bearer comum')
      .expect(403);
    await request(app.getHttpServer())
      .delete('/simples-nacional/empresas')
      .set('Authorization', 'Bearer admin')
      .expect(200);

    expect(simplesNacionalService.limpar).toHaveBeenCalledTimes(1);
  });
});
