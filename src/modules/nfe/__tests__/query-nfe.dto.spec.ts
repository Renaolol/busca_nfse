import { validate } from 'class-validator';
import { QueryNfeDto } from '../dto/query-nfe.dto';
import { StartNfeSyncDto } from '../dto/start-sync.dto';

describe('NFE document identifier DTOs', () => {
  it.each(['01861020970', '12345678000199'])('accepts CPF or CNPJ %s in the document search filter', async (identifier) => {
    const dto = Object.assign(new QueryNfeDto(), { cnpjConsulta: identifier });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each(['123456789012', '1234567890123'])('rejects invalid identifier length %s in the document search filter', async (identifier) => {
    const dto = Object.assign(new QueryNfeDto(), { cnpjConsulta: identifier });

    await expect(validate(dto)).resolves.toHaveLength(1);
  });

  it('accepts CPF when starting a sync control', async () => {
    const dto = Object.assign(new StartNfeSyncDto(), {
      clienteId: '5dcf7174-0fe0-40cc-855e-f8c4e5658cd0',
      cnpjConsulta: '01861020970'
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
