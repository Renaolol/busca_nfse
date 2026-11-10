import { Module } from '@nestjs/common';
import { NfseModule } from '../modules/nfse/nfse.module';
import { UpdatesModule } from '../modules/updates/updates.module';
import { SyncModule } from '../modules/sync/sync.module';
import { DailyUpdateReportJob } from './daily-update-report.job';
import { GerarDanfsePendenteJob } from './gerar-danfse-pendente.job';
import { LimparTemporariosJob } from './limpar-temporarios.job';
import { ReprocessarErrosJob } from './reprocessar-erros.job';
import { SyncNfseAdnJob } from './sync-nfse-adn.job';
import { VerificarCertificadosJob } from './verificar-certificados.job';

@Module({
  imports: [SyncModule, NfseModule, UpdatesModule],
  providers: [
    DailyUpdateReportJob,
    SyncNfseAdnJob,
    VerificarCertificadosJob,
    GerarDanfsePendenteJob,
    ReprocessarErrosJob,
    LimparTemporariosJob
  ],
  exports: [
    SyncNfseAdnJob,
    VerificarCertificadosJob,
    GerarDanfsePendenteJob,
    ReprocessarErrosJob,
    LimparTemporariosJob
  ]
})
export class JobsModule {}
