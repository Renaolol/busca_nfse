import {
  isXmlReader30DifalIcms4,
  resolveXmlReader30DifalBase,
  resolveXmlReader30DifalIcms4Amount,
  resolveXmlReader30DifalRate
} from '../../../../frontend/xml-reader30-difal-utils.js';

describe('xml-reader30-difal-utils', () => {
  it('usa pICMSInter do XML para identificar a aliquota de 4%', () => {
    const item = {
      aliquotaIcmsRaw: '18.0000',
      aliquotaInterRaw: '4.0000',
      baseCalculoIcmsRaw: '1000.00',
      baseCalculoInterRaw: '950.00',
      valorIcmsRaw: '180.00'
    };

    expect(resolveXmlReader30DifalRate(item)).toBe(4);
    expect(isXmlReader30DifalIcms4(item)).toBe(true);
    expect(resolveXmlReader30DifalBase(item)).toBe(950);
    expect(resolveXmlReader30DifalIcms4Amount(item)).toBe(38);
  });

  it('mantem pICMS como alternativa quando nao ha pICMSInter no XML', () => {
    const item = { aliquotaIcmsRaw: '4.0000', aliquotaInterRaw: '0' };

    expect(resolveXmlReader30DifalRate(item)).toBe(4);
    expect(isXmlReader30DifalIcms4(item)).toBe(true);
  });

  it('prioriza um campo XML que indique 4% sobre outra aliquota', () => {
    expect(resolveXmlReader30DifalRate({ aliquotaInterRaw: '12', aliquotaIcmsRaw: '4' })).toBe(4);
  });
});
