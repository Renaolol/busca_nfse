import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UpdatesService } from '../modules/updates/updates.service';

@Injectable()
export class DailyUpdateReportJob implements OnModuleInit, OnModuleDestroy {
  static readonly jobName = 'relatorio_diario_atualizacoes';

  private readonly logger = new Logger(DailyUpdateReportJob.name);
  private readonly checkIntervalMs = 60_000;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly updatesService: UpdatesService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.generateIfDue(), this.checkIntervalMs);
    this.timer.unref?.();
    void this.generateIfDue();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async generateIfDue(now = new Date()): Promise<void> {
    try {
      await this.updatesService.generateCurrentDailyReportIfDue(now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao gerar o relatorio diario de atualizacoes: ${message}`);
    }
  }
}
