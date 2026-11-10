import { UpdatesService } from '../../modules/updates/updates.service';
import { DailyUpdateReportJob } from '../daily-update-report.job';

describe('DailyUpdateReportJob', () => {
  const updatesService = {
    generateCurrentDailyReportIfDue: jest.fn()
  };
  const job = new DailyUpdateReportJob(updatesService as unknown as UpdatesService);

  beforeEach(() => jest.resetAllMocks());

  it('delegates idempotent report generation to the service', async () => {
    const now = new Date('2026-11-10T20:30:00.000Z');

    await job.generateIfDue(now);

    expect(updatesService.generateCurrentDailyReportIfDue).toHaveBeenCalledWith(now);
  });

  it('clears its polling timer during shutdown', () => {
    jest.useFakeTimers();
    try {
      updatesService.generateCurrentDailyReportIfDue.mockReset();
      job.onModuleInit();

      expect(updatesService.generateCurrentDailyReportIfDue).toHaveBeenCalledTimes(1);
      job.onModuleDestroy();
      jest.advanceTimersByTime(120_000);

      expect(updatesService.generateCurrentDailyReportIfDue).toHaveBeenCalledTimes(1);
    } finally {
      job.onModuleDestroy();
      jest.useRealTimers();
    }
  });
});
