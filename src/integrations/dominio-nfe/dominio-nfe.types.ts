export interface DominioNfeXmlRecord {
  catalogoId: number;
  codigoEmpresa: number;
  cnpjEmpresa: string;
  chaveAcesso?: string;
  dataEmissao?: string;
  xmlBase64: string;
}

export interface DominioNfeXmlSource {
  listDocuments(params: {
    cnpjs: string[];
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
  }): Promise<DominioNfeXmlRecord[]>;
}

export const DOMINIO_NFE_XML_SOURCE = Symbol('DOMINIO_NFE_XML_SOURCE');
