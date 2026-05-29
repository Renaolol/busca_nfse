import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LimparTemporariosJob } from './limpar-temporarios.job';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const job = app.get(LimparTemporariosJob);
  const olderThanHours = Number(process.env.JOB_OLDER_THAN_HOURS ?? 1);
  const result = await job.run({
    olderThanHours:
      Number.isFinite(olderThanHours) && olderThanHours > 0
        ? Math.floor(olderThanHours)
        : 1
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
