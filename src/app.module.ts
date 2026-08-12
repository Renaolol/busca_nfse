import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { JobsModule } from './jobs/jobs.module';
import { AuditModule } from './modules/audit/audit.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AuthModule } from './modules/auth/auth.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { CompareSpedModule } from './modules/compare-sped/compare-sped.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CteModule } from './modules/cte/cte.module';
import { DocumentChecksModule } from './modules/document-checks/document-checks.module';
import { EstablishmentsModule } from './modules/establishments/establishments.module';
import { HealthModule } from './modules/health/health.module';
import { NfeModule } from './modules/nfe/nfe.module';
import { NfseModule } from './modules/nfse/nfse.module';
import { StorageModule } from './modules/storage/storage.module';
import { SyncModule } from './modules/sync/sync.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    AuthModule,
    HealthModule,
    AlertsModule,
    DocumentChecksModule,
    ClientsModule,
    CteModule,
    EstablishmentsModule,
    CertificatesModule,
    CompareSpedModule,
    SyncModule,
    NfseModule,
    NfeModule,
    AuditModule,
    JobsModule
  ],
  controllers: [AppController]
})
export class AppModule {}
