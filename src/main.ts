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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('NFS-e Collector API')
    .setDescription('API interna para sincronizacao, armazenamento e consulta de NFS-e Nacional')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.useStaticAssets(join(process.cwd(), 'frontend'), { prefix: '/app' });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

function validateRequiredEnvironment(): void {
  const certMasterKey = process.env.CERT_MASTER_KEY?.trim();
  if (!certMasterKey || /^change[-_ ]?me/i.test(certMasterKey)) {
    throw new Error('CERT_MASTER_KEY obrigatoria e deve ser configurada com valor seguro');
  }

}

bootstrap();
