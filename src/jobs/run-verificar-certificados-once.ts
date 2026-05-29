import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { VerificarCertificadosJob } from './verificar-certificados.job';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const job = app.get(VerificarCertificadosJob);
  const result = await job.run();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));

  await app.close();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
