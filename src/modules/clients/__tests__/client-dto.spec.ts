import { validate } from 'class-validator';
import { CreateClientDto } from '../dto/create-client.dto';
import { UpdateClientDto } from '../dto/update-client.dto';

describe('Client DTO document validation', () => {
  it.each(['12345678901', '12345678000190'])('accepts %s as a CPF/CNPJ identifier', async (identifier) => {
    const dto = Object.assign(new CreateClientDto(), {
      razaoSocial: 'Cliente Teste',
      cnpj: identifier
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects identifiers that are not 11 or 14 numeric digits', async () => {
    const dto = Object.assign(new CreateClientDto(), {
      razaoSocial: 'Cliente Teste',
      cnpj: '1234567890'
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'cnpj')).toBe(true);
  });

  it('accepts CPF when updating a client', async () => {
    const dto = Object.assign(new UpdateClientDto(), { cnpj: '12345678901' });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
