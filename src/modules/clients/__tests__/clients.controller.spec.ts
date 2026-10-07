import 'reflect-metadata';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { ClientsController } from '../clients.controller';

describe('ClientsController', () => {
  it('permite que administradores e usuarios comuns cadastrem clientes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClientsController.prototype.create)).toEqual(['admin', 'comum']);
  });
});
