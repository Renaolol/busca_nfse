import municipiosIbge from '../data/municipios-ibge.json';

const MUNICIPIOS_IBGE: Record<string, string> = municipiosIbge;

export function resolveMunicipioIbge(codigo?: string | null): string | undefined {
  const digits = String(codigo || '').replace(/\D/g, '');
  if (digits.length < 6) {
    return undefined;
  }

  return MUNICIPIOS_IBGE[digits];
}

export function replaceMunicipioCodigoComNome(value?: string | null): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return value ?? undefined;
  }

  const match = normalized.match(/^(\d{6,7})(\s*\/\s*[A-Za-z]{2})?$/);
  if (!match) {
    return value ?? undefined;
  }

  const nomeUf = resolveMunicipioIbge(match[1]);
  return nomeUf ?? value ?? undefined;
}
