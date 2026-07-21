export const DANFE_PDF_GENERATOR = Symbol('DANFE_PDF_GENERATOR');

export interface DanfePdfGenerator {
  generateNfePdf(params: {
    xml: string;
    chaveAcesso?: string;
  }): Promise<Buffer>;
}
