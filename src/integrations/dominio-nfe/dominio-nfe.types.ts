export interface DominioNfeXmlRecord {
  catalogoId: number;
  codigoEmpresa: number;
  cnpjEmpresa: string;
  chaveAcesso?: string;
  dataEmissao?: string;
  xmlBase64: string;
}

export interface DominioNfeCatalogRecord {
  catalogoId: number;
  codigoEmpresa: number;
  cnpjEmpresa: string;
  chaveAcesso?: string;
  dataEmissao?: string;
}

export interface DominioEmpresaEnderecoRecord {
  codigoEmpresa: number;
  cnpjEmpresa: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  municipioCodigoIbge?: string;
  uf?: string;
}

export interface DominioNfeXmlSource {
  listCompanyAddresses(cnpjs: string[]): Promise<DominioEmpresaEnderecoRecord[]>;
  listDocuments(params: {
    cnpjs: string[];
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIds?: number[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }): Promise<DominioNfeXmlRecord[]>;
  listCatalog(params: {
    cnpjs: string[];
    limit?: number;
    dataEmissaoInicio?: string;
    dataEmissaoFim?: string;
    chavesAcesso?: string[];
    catalogoIds?: number[];
    catalogoIdMinExclusive?: number;
    sortDirection?: 'asc' | 'desc';
  }): Promise<DominioNfeCatalogRecord[]>;
}

export const DOMINIO_NFE_XML_SOURCE = Symbol('DOMINIO_NFE_XML_SOURCE');
