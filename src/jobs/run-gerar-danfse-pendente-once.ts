import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GerarDanfsePendenteJob } from './gerar-danfse-pendente.job';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const job = app.get(GerarDanfsePendenteJob);
  const limit = Number(process.env.JOB_LIMIT ?? 200);
  const clienteId = process.env.JOB_CLIENTE_ID?.trim() || undefined;

  const result = await job.run({
    clienteId,
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));

  await app.close();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
