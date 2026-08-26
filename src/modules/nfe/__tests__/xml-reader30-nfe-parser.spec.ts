import { extractNfeLineItems } from '../../../../frontend/xml-reader30-nfe-parser.js';

function extractSingleItem(xml: string) {
  const items = extractNfeLineItems(xml);
  expect(items).toHaveLength(1);
  return items[0];
}

describe('xml-reader30-nfe-parser', () => {
  it('mantem BC ICMS zerado quando ICMS60 nao possui campos de valor', () => {
    const item = extractSingleItem(`
      <?xml version="1.0" encoding="UTF-8"?>
      <NFe>
        <infNFe>
          <det nItem="1">
            <prod>
              <cProd>1</cProd>
              <xProd>Conjunto 10 Capa Porca Boliviana 32/33mm</xProd>
              <qCom>1.0000</qCom>
              <vUnCom>74.40</vUnCom>
              <vProd>74.40</vProd>
            </prod>
            <imposto>
              <ICMS>
                <ICMS60>
                  <orig>0</orig>
                  <CST>60</CST>
                </ICMS60>
              </ICMS>
            </imposto>
          </det>
        </infNFe>
      </NFe>
    `);

    expect(item.cstCsosn).toBe('60');
    expect(item.baseCalculoIcmsRaw).toBe('0');
    expect(item.baseCalculoIcms).toBe('0');
  });

  it('nao usa o valor total do item como BC ICMS em ICMS61', () => {
    const item = extractSingleItem(`
      <?xml version="1.0" encoding="UTF-8"?>
      <NFe>
        <infNFe>
          <det nItem="1">
            <prod>
              <cProd>2</cProd>
              <xProd>Oleo Diesel B S10</xProd>
              <qCom>1.0000</qCom>
              <vUnCom>4221.06</vUnCom>
              <vProd>4221.06</vProd>
            </prod>
            <imposto>
              <ICMS>
                <ICMS61>
                  <orig>0</orig>
                  <CST>61</CST>
                  <qBCMonoRet>700.0100</qBCMonoRet>
                  <adRemICMSRet>1.1700</adRemICMSRet>
                  <vICMSMonoRet>819.01</vICMSMonoRet>
                </ICMS61>
              </ICMS>
            </imposto>
          </det>
        </infNFe>
      </NFe>
    `);

    expect(item.cstCsosn).toBe('61');
    expect(item.baseCalculoIcmsRaw).toBe('0');
    expect(item.baseCalculoIcms).toBe('0');
    expect(item.qBCMonoRetRaw).toBe('700.0100');
    expect(item.vICMSMonoRetRaw).toBe('819.01');
  });

  it('nao usa a quantidade do produto como BC Mono quando o campo nao existe', () => {
    const item = extractSingleItem(`
      <?xml version="1.0" encoding="UTF-8"?>
      <NFe>
        <infNFe>
          <det nItem="1">
            <prod>
              <cProd>3</cProd>
              <xProd>Graxa Ipiranga Chassis</xProd>
              <qCom>2.40</qCom>
              <vUnCom>50.00</vUnCom>
              <vProd>120.00</vProd>
            </prod>
            <imposto>
              <ICMS>
                <ICMS60>
                  <orig>0</orig>
                  <CST>60</CST>
                  <vBCSTRet>0</vBCSTRet>
                  <pST>0.0000</pST>
                  <vBCEfet>119.76</vBCEfet>
                  <pICMSEfet>19.0000</pICMSEfet>
                  <vICMSEfet>22.75</vICMSEfet>
                </ICMS60>
              </ICMS>
            </imposto>
          </det>
        </infNFe>
      </NFe>
    `);

    expect(item.cstCsosn).toBe('60');
    expect(item.qBCMonoRetRaw).toBe('0');
    expect(item.qBCMonoRet).toBe('0');
  });
});
