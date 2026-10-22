import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryNfeDto } from './query-nfe.dto';

describe('QueryNfeDto', () => {
  it('interpreta false explicitamente sem converter texto invalido em false', () => {
    const dto = plainToInstance(QueryNfeDto, {
      somenteXmlCompleto: 'false',
      somenteResumos: 'true'
    });
    expect(dto.somenteXmlCompleto).toBe(false);
    expect(dto.somenteResumos).toBe(true);
    expect(validateSync(dto)).toHaveLength(0);

    const invalid = plainToInstance(QueryNfeDto, { somenteXmlCompleto: 'talvez' });
    expect(validateSync(invalid).some((error) => error.property === 'somenteXmlCompleto')).toBe(true);
  });
});
