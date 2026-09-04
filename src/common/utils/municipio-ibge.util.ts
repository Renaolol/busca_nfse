import municipiosIbge from '../data/municipios-ibge.json';

const MUNICIPIOS_IBGE: Record<string, string> = municipiosIbge;

function normalizeMunicipioLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const MUNICIPIOS_POR_NOME = new Map<string, string[]>();
const MUNICIPIOS_POR_NOME_E_UF = new Map<string, string[]>();

Object.values(MUNICIPIOS_IBGE).forEach((municipio) => {
  const [cidade, uf] = municipio.split('/');
  const nomeNormalizado = normalizeMunicipioLookup(cidade);
  const porNome = MUNICIPIOS_POR_NOME.get(nomeNormalizado) ?? [];
  porNome.push(municipio);
  MUNICIPIOS_POR_NOME.set(nomeNormalizado, porNome);

  const nomeUfNormalizado = `${nomeNormalizado}/${uf}`;
  const porNomeUf = MUNICIPIOS_POR_NOME_E_UF.get(nomeUfNormalizado) ?? [];
  porNomeUf.push(municipio);
  MUNICIPIOS_POR_NOME_E_UF.set(nomeUfNormalizado, porNomeUf);
});

function findMunicipiosByNome(nomeNormalizado: string, uf?: string): string[] {
  return uf
    ? MUNICIPIOS_POR_NOME_E_UF.get(`${nomeNormalizado}/${uf}`) ?? []
    : MUNICIPIOS_POR_NOME.get(nomeNormalizado) ?? [];
}

export function resolveMunicipioIbge(codigo?: string | null): string | undefined {
  const digits = String(codigo || '').replace(/\D/g, '');
  if (digits.length < 6) {
    return undefined;
  }

  return MUNICIPIOS_IBGE[digits];
}

/**
 * Converte uma cidade informada por extenso para a grafia oficial da base IBGE.
 * O XML de alguns municipios traz a cidade em caixa alta ou com um "s" residual
 * ao final (por exemplo, "MONDAIs"). A conversao so ocorre quando o resultado
 * identifica uma unica cidade, para nao trocar municipios homonimos.
 */
export function resolveMunicipioNome(nome?: string | null): string | undefined {
  const original = String(nome ?? '').trim();
  if (!original) {
    return undefined;
  }

  const municipioUfMatch = original.match(/^(.*?)\s*\/\s*([A-Za-z]{2})\s*$/);
  const cidadeInformada = municipioUfMatch?.[1]?.trim() || original;
  const ufInformada = municipioUfMatch?.[2]?.toUpperCase();
  const normalized = normalizeMunicipioLookup(cidadeInformada);
  if (!normalized) {
    return undefined;
  }

  const exactMatches = findMunicipiosByNome(normalized, ufInformada);

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  // Alguns provedores deixam o marcador de plural do campo seguinte colado ao
  // nome. Aceitamos apenas essa correcao de um caractere e apenas sem ambiguidade.
  if (!normalized.endsWith('s')) {
    return undefined;
  }

  const withoutTrailingS = normalized.slice(0, -1);
  const matchesWithoutTrailingS = findMunicipiosByNome(withoutTrailingS, ufInformada);

  return matchesWithoutTrailingS.length === 1 ? matchesWithoutTrailingS[0] : undefined;
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
