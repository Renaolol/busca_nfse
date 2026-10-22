import 'reflect-metadata';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { NfeController } from '../nfe.controller';

describe('NfeController - diagnostico SEFAZ', () => {
  it('restringe status, ativacao, consulta e encerramento a administradores', () => {
    expect(Reflect.getMetadata(ROLES_KEY, NfeController.prototype.getSefazDiagnosticModeStatus)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, NfeController.prototype.startSefazDiagnosticMode)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, NfeController.prototype.executeSefazDiagnosticQuery)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, NfeController.prototype.stopSefazDiagnosticMode)).toEqual(['admin']);
  });
});
