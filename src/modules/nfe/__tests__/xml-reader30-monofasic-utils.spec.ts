import { computeXmlReader30MonofasicValues } from '../../../../frontend/xml-reader30-monofasic-utils.js';

describe('xml-reader30-monofasic-utils', () => {
  const periodos = [
    {
      dataInicio: '2026-08-01',
      dataFim: '',
      aliquota: '12'
    }
  ];

  it('nao gera credito monofasico para gasolina', () => {
    const result = computeXmlReader30MonofasicValues(
      '2026-08-15',
      '61',
      '700.0100',
      'Gasolina Comum',
      periodos
    );

    expect(result.aliqVigenteRaw).toBe('12.00');
    expect(result.valorCorretoRaw).toBe('0.00');
    expect(result.valorCorreto).toBe('0.00');
  });

  it('continua gerando credito monofasico para produtos nao excluidos', () => {
    const result = computeXmlReader30MonofasicValues(
      '2026-08-15',
      '61',
      '700.0100',
      'Oleo Diesel B S10',
      periodos
    );

    expect(result.aliqVigenteRaw).toBe('12.00');
    expect(result.valorCorretoRaw).toBe('8400.12');
    expect(result.valorCorreto).toBe('8400.12');
  });
});
