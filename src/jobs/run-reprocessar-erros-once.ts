import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReprocessarErrosJob } from './reprocessar-erros.job';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const job = app.get(ReprocessarErrosJob);
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
