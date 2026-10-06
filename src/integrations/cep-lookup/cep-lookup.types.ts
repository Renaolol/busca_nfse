export interface CepLookupResult {
  cep: string;
  logradouro: string;
  bairro: string;
  municipioNome: string;
  municipioCodigoIbge: string;
  uf: string;
}

export interface CepLookupClient {
  lookup(cep: string): Promise<CepLookupResult | null>;
}

export const CEP_LOOKUP_CLIENT = Symbol('CEP_LOOKUP_CLIENT');
