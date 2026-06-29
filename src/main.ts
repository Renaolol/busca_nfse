import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';

async function bootstrap(): Promise<void> {
  validateRequiredEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const requestBodyLimit = process.env.REQUEST_BODY_LIMIT ?? '10mb';
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const swaggerEnabled = resolveSwaggerEnabled(nodeEnv);

  app.useBodyParser('json', { limit: requestBodyLimit });
  app.useBodyParser('urlencoded', { limit: requestBodyLimit, extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false
    })
  );
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Documentos Fiscais Collector API')
      .setDescription('API interna para sincronizacao, armazenamento e consulta de NFS-e Nacional e NF-e')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.useStaticAssets(join(process.cwd(), 'frontend'), { prefix: '/app' });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

function validateRequiredEnvironment(): void {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const adnClientMode = (process.env.NFSE_ADN_CLIENT_MODE ?? '').trim().toLowerCase();
  const certMasterKey = process.env.CERT_MASTER_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const storageRootPath = process.env.STORAGE_ROOT_PATH?.trim();
  const nfseApiBaseProducao = process.env.NFSE_API_BASE_URL_PRODUCAO?.trim();
  const nfseApiBaseRestrita = process.env.NFSE_API_BASE_URL_RESTRITA?.trim();

  if (!certMasterKey || /^change[-_ ]?me/i.test(certMasterKey)) {
    throw new Error('CERT_MASTER_KEY obrigatoria e deve ser configurada com valor seguro');
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL obrigatoria');
  }

  if (!storageRootPath) {
    throw new Error('STORAGE_ROOT_PATH obrigatoria');
  }

  if (adnClientMode === 'real') {
    if (!nfseApiBaseProducao) {
      throw new Error('NFSE_API_BASE_URL_PRODUCAO obrigatoria quando NFSE_ADN_CLIENT_MODE=real');
    }
    if (!nfseApiBaseRestrita) {
      throw new Error('NFSE_API_BASE_URL_RESTRITA obrigatoria quando NFSE_ADN_CLIENT_MODE=real');
    }
  }

  if (nodeEnv === 'production') {
    if (adnClientMode !== 'real') {
      throw new Error('Em producao, NFSE_ADN_CLIENT_MODE deve ser "real"');
    }

    if (process.env.NFSE_ADN_REJECT_UNAUTHORIZED === 'false') {
      throw new Error('Em producao, NFSE_ADN_REJECT_UNAUTHORIZED nao pode ser "false"');
    }
  }
}

function resolveSwaggerEnabled(nodeEnv: string): boolean {
  const raw = process.env.ENABLE_SWAGGER?.trim().toLowerCase();
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }

  return nodeEnv !== 'production';
}

bootstrap();
