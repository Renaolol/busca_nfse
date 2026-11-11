import { UpdatesController } from '../updates.controller';
import { UpdatesService } from '../updates.service';

describe('UpdatesController', () => {
  const updatesService = {
    listDailyReports: jest.fn(),
    getDailyReportPdf: jest.fn(),
    listSystemUpdates: jest.fn(),
    createSystemUpdate: jest.fn()
  };
  const controller = new UpdatesController(updatesService as unknown as UpdatesService);

  beforeEach(() => jest.resetAllMocks());

  it('lista relatorios para usuarios autenticados', () => {
    updatesService.listDailyReports.mockReturnValue([{ id: 'report-1' }]);

    expect(controller.listDailyReports()).toEqual([{ id: 'report-1' }]);
    expect(updatesService.listDailyReports).toHaveBeenCalledTimes(1);
  });

  it('solicita o PDF do relatorio pelo identificador', async () => {
    updatesService.getDailyReportPdf.mockResolvedValue({ fileName: 'relatorio.pdf' });

    await expect(controller.downloadDailyReportPdf('report-1')).resolves.toEqual({ fileName: 'relatorio.pdf' });
    expect(updatesService.getDailyReportPdf).toHaveBeenCalledWith('report-1');
  });

  it('cria registro de atualizacao com o usuario autenticado', () => {
    const dto = { titulo: 'Novo recurso', descricao: 'Foi adicionada uma nova tela.' };
    const user = { userId: 'user-1', username: 'admin', role: 'admin' as const };
    const request = { authUser: user } as never;
    updatesService.createSystemUpdate.mockReturnValue({ id: 'update-1' });

    expect(controller.createSystemUpdate(dto, request)).toEqual({ id: 'update-1' });
    expect(updatesService.createSystemUpdate).toHaveBeenCalledWith(dto, user);
  });
});
