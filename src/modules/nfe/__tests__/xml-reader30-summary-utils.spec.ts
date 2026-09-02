import {
  isXmlReader30DocumentCancelled,
  shouldIncludeDocumentValueInSum
} from '../../../../frontend/xml-reader30-summary-utils.js';

describe('xml-reader30-summary-utils', () => {
  it('exclui NF-e cancelada da soma mesmo quando o status parece autorizado', () => {
    const item = {
      statusFiscal: 'Autorizada',
      valor: '22949.47',
      raw: {
        statusFiscal: 'Autorizada',
        cancelada: true,
        eventosResumo: 'Evento de cancelamento registrado'
      }
    };

    expect(isXmlReader30DocumentCancelled(item)).toBe(true);
    expect(shouldIncludeDocumentValueInSum(item)).toBe(false);
  });

  it('mantem documentos autorizados na soma', () => {
    const item = {
      statusFiscal: 'Autorizada',
      valor: '100.00',
      raw: {
        statusFiscal: 'Autorizada',
        cancelada: false
      }
    };

    expect(isXmlReader30DocumentCancelled(item)).toBe(false);
    expect(shouldIncludeDocumentValueInSum(item)).toBe(true);
  });

  it('nao exclui CT-e autorizado por cancelamento de CT-e complementar no resumo de eventos', () => {
    const item = {
      statusFiscal: 'Autorizada',
      cancelada: false,
      valor: '58.28',
      eventosResumo: 'Cancelamento CT-e Complementar Registrado / CT-e Complementar Registrado',
      raw: {
        statusFiscal: 'Autorizada',
        cancelada: false,
        eventosResumo: 'Cancelamento CT-e Complementar Registrado'
      }
    };

    expect(isXmlReader30DocumentCancelled(item)).toBe(false);
    expect(shouldIncludeDocumentValueInSum(item)).toBe(true);
  });
});
