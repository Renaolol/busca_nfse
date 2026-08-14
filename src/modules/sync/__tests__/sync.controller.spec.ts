import 'reflect-metadata';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { SyncController } from '../sync.controller';

describe('SyncController', () => {
  function getRoles(methodName: keyof SyncController) {
    return Reflect.getMetadata(ROLES_KEY, SyncController.prototype[methodName]) as string[] | undefined;
  }

  it('permite admin e comum no reprocessamento de NSUs passados', () => {
    expect(getRoles('reprocessPastNsus')).toEqual(['admin', 'comum']);
    expect(getRoles('startPastNsuRecoveryExecution')).toEqual(['admin', 'comum']);
    expect(getRoles('getPastNsuRecoveryExecution')).toEqual(['admin', 'comum']);
  });
});
