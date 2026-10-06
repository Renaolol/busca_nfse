import { Injectable } from '@nestjs/common';
import { CepLookupClient, CepLookupResult } from './cep-lookup.types';

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
  erro?: boolean | string;
}

@Injectable()
export class RealCepLookupClient implements CepLookupClient {
  async lookup(cep: string): Promise<CepLookupResult | null> {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`ViaCEP retornou HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ViaCepResponse;
    if (payload.erro === true || payload.erro === 'true') return null;

    return {
      cep: String(payload.cep || cep).replace(/\D/g, ''),
      logradouro: String(payload.logradouro || ''),
      bairro: String(payload.bairro || ''),
      municipioNome: String(payload.localidade || ''),
      municipioCodigoIbge: String(payload.ibge || ''),
      uf: String(payload.uf || '').toUpperCase()
    };
  }
}
