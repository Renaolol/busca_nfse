import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CertificatesController } from '../../src/modules/certificates/certificates.controller';
import { CertificatesService } from '../../src/modules/certificates/certificates.service';
import { NfseController } from '../../src/modules/nfse/nfse.controller';
import { NfseService } from '../../src/modules/nfse/nfse.service';
import { SyncController } from '../../src/modules/sync/sync.controller';
import { SyncService } from '../../src/modules/sync/sync.service';

describe('Client Scope Validation (e2e)', () => {
  let app: INestApplication;

  const certificatesService = {
    findOne: jest.fn().mockResolvedValue({ id: 'cert-1' })
  };

  const nfseService = {
    getXml: jest.fn().mockResolvedValue({ id: 'doc-1', contentType: 'application/xml' })
  };

  const syncService = {
    listLogs: jest.fn().mockResolvedValue([{ id: 'log-1' }]),
    reprocessPastNsus: jest.fn().mockResolvedValue({ documentosSalvos: 0 })
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CertificatesController, NfseController, SyncController],
      providers: [
        { provide: CertificatesService, useValue: certificatesService },
        { provide: NfseService, useValue: nfseService },
        { provide: SyncService, useValue: syncService }
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
  });

  it('retorna 400 quando clienteId nao e informado em GET /certificados/:id', async () => {
    await request(app.getHttpServer()).get('/certificados/cert-1').expect(400);
    expect(certificatesService.findOne).not.toHaveBeenCalled();
  });

  it('retorna 400 quando clienteId e invalido em GET /certificados/:id', async () => {
    await request(app.getHttpServer())
      .get('/certificados/cert-1')
      .query({ clienteId: 'invalido' })
      .expect(400);
    expect(certificatesService.findOne).not.toHaveBeenCalled();
  });

  it('aceita clienteId valido em GET /certificados/:id', async () => {
    const clienteId = '550e8400-e29b-41d4-a716-446655440000';
    await request(app.getHttpServer())
      .get('/certificados/cert-1')
      .query({ clienteId })
      .expect(200);
    expect(certificatesService.findOne).toHaveBeenCalledWith('cert-1', clienteId);
  });

  it('retorna 400 quando clienteId nao e informado em GET /nfse/:id/xml', async () => {
    await request(app.getHttpServer()).get('/nfse/doc-1/xml').expect(400);
    expect(nfseService.getXml).not.toHaveBeenCalled();
  });

  it('aceita clienteId valido em GET /nfse/:id/xml', async () => {
    const clienteId = '550e8400-e29b-41d4-a716-446655440001';
    await request(app.getHttpServer())
      .get('/nfse/doc-1/xml')
      .query({ clienteId })
      .expect(200);
    expect(nfseService.getXml).toHaveBeenCalledWith('doc-1', clienteId);
  });

  it('retorna 400 quando clienteId nao e informado em GET /sync/logs', async () => {
    await request(app.getHttpServer()).get('/sync/logs').expect(400);
    expect(syncService.listLogs).not.toHaveBeenCalled();
  });

  it('aceita clienteId valido em GET /sync/logs', async () => {
    const clienteId = '550e8400-e29b-41d4-a716-446655440002';
    await request(app.getHttpServer())
      .get('/sync/logs')
      .query({ clienteId })
      .expect(200);
    expect(syncService.listLogs).toHaveBeenCalledWith(clienteId);
  });

  it('aceita body vazio em POST /sync/reprocessar-nsus-passados', async () => {
    await request(app.getHttpServer()).post('/sync/reprocessar-nsus-passados').send({}).expect(201);
    expect(syncService.reprocessPastNsus).toHaveBeenCalledWith({});
  });

  it('retorna 400 quando clienteId do reprocessamento de NSUs e invalido', async () => {
    await request(app.getHttpServer())
      .post('/sync/reprocessar-nsus-passados')
      .send({ clienteId: 'invalido' })
      .expect(400);
    expect(syncService.reprocessPastNsus).not.toHaveBeenCalled();
  });
});
