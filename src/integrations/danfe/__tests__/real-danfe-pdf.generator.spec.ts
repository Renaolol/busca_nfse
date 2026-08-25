import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { RealDanfePdfGenerator } from '../real-danfe-pdf.generator';

jest.mock('node:fs/promises', () => ({
  mkdtemp: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
  stat: jest.fn()
}));

describe('RealDanfePdfGenerator', () => {
  type TestableGenerator = RealDanfePdfGenerator & {
    loadDanfeModule: () => {
      NFE_GerarDanfe: jest.Mock;
    };
    loadSharedModule: () => {
      XmlParser: new () => {
        convertXmlNfeProcToJson(xml: string): {
          chave: string;
          data: Record<string, unknown>;
        };
      };
    };
    waitForGeneratedPdf: (outputPath: string) => Promise<void>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mkdtemp as jest.Mock).mockResolvedValue('/tmp/notasync-danfe-test');
    (readFile as jest.Mock).mockResolvedValue(Buffer.from('%PDF-1.4 fake', 'utf8'));
    (rm as jest.Mock).mockResolvedValue(undefined);
  });

  it('normaliza itens sem ICMS antes de gerar DANFE', async () => {
    const generator = new RealDanfePdfGenerator() as TestableGenerator;
    const NFE_GerarDanfe = jest.fn().mockResolvedValue({
      success: true,
      message: 'ok'
    });

    jest.spyOn(generator, 'loadDanfeModule').mockReturnValue({
      NFE_GerarDanfe
    });
    jest.spyOn(generator, 'loadSharedModule').mockReturnValue({
      XmlParser: class {
        convertXmlNfeProcToJson() {
          return {
            chave: '35260612345678000199550010000001231000001231',
            data: {
              NFe: {
                infNFe: {
                  det: [
                    {
                      prod: {
                        xProd: 'Servico conjugado'
                      },
                      imposto: {}
                    },
                    {
                      prod: {
                        xProd: 'Produto com ICMS'
                      },
                      imposto: {
                        ICMS: {
                          ICMS00: {
                            CST: '00'
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          };
        }
      }
    });
    jest.spyOn(generator, 'waitForGeneratedPdf').mockResolvedValue(undefined);

    const result = await generator.generateNfePdf({
      xml: '<nfeProc />',
      chaveAcesso: '35260612345678000199550010000001231000001231'
    });

    expect(result).toEqual(Buffer.from('%PDF-1.4 fake', 'utf8'));
    expect(NFE_GerarDanfe).toHaveBeenCalledWith({
      data: {
        NFe: {
          infNFe: {
            det: [
              {
                prod: {
                  xProd: 'Servico conjugado'
                },
                imposto: {
                  ICMS: {}
                }
              },
              {
                prod: {
                  xProd: 'Produto com ICMS'
                },
                imposto: {
                  ICMS: {
                    ICMS00: {
                      CST: '00'
                    }
                  }
                }
              }
            ]
          }
        }
      },
      chave: '35260612345678000199550010000001231000001231',
      outputPath: '/tmp/notasync-danfe-test/35260612345678000199550010000001231000001231.pdf'
    });
  });

  it('usa a chave extraida do XML quando nao recebe override', async () => {
    const generator = new RealDanfePdfGenerator() as TestableGenerator;
    const NFE_GerarDanfe = jest.fn().mockResolvedValue({
      success: true,
      message: 'ok'
    });

    jest.spyOn(generator, 'loadDanfeModule').mockReturnValue({
      NFE_GerarDanfe
    });
    jest.spyOn(generator, 'loadSharedModule').mockReturnValue({
      XmlParser: class {
        convertXmlNfeProcToJson() {
          return {
            chave: '35260612345678000199550010000001231000009999',
            data: {
              NFe: {
                infNFe: {
                  det: {
                    prod: {
                      xProd: 'Produto unico'
                    },
                    imposto: {
                      ICMS: null
                    }
                  }
                }
              }
            }
          };
        }
      }
    });
    jest.spyOn(generator, 'waitForGeneratedPdf').mockResolvedValue(undefined);

    await generator.generateNfePdf({
      xml: '<nfeProc />'
    });

    expect(NFE_GerarDanfe).toHaveBeenCalledWith({
      data: {
        NFe: {
          infNFe: {
            det: [
              {
                prod: {
                  xProd: 'Produto unico'
                },
                imposto: {
                  ICMS: {}
                }
              }
            ]
          }
        }
      },
      chave: '35260612345678000199550010000001231000009999',
      outputPath: expect.stringMatching(
        /^\/tmp\/notasync-danfe-test\/[0-9a-f-]+\.pdf$/
      )
    });
  });
});
