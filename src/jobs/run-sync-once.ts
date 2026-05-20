import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncService } from '../modules/sync/sync.service';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const syncService = app.get(SyncService);
  const result = await syncService.runNow();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));

  await app.close();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
