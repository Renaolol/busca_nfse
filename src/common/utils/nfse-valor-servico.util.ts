export function resolveNfseValorServico(valorServico?: string | null, descricaoServico?: string | null): string | undefined {
  if (!isZeroAmount(valorServico) || !descricaoServico) {
    return valorServico ?? undefined;
  }

  const descricaoNormalizada = descricaoServico
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const match = descricaoNormalizada.match(
    /total\s+de\s+creditos?\s+auxilio[-\s]+alimentacao\s*:\s*(?:r\s*\$\s*)?([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i
  );
  const valorDescrito = match?.[1];
  if (!valorDescrito) {
    return valorServico ?? undefined;
  }

  const normalizedValue = valorDescrito.includes(',')
    ? valorDescrito.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(valorDescrito)
      ? valorDescrito.replace(/\./g, '')
      : valorDescrito;
  const [inteiro, centavos = ''] = normalizedValue.split('.');
  const valorFormatado = `${inteiro}.${centavos.padEnd(2, '0').slice(0, 2)}`;

  return Number(valorFormatado) > 0 ? valorFormatado : valorServico ?? undefined;
}

function isZeroAmount(value?: string | null): boolean {
  if (!value?.trim()) {
    return false;
  }

  const normalizedValue =
    value.includes(',') && value.includes('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(',', '.');
  return /^[-+]?\d+(?:\.\d+)?$/.test(normalizedValue.trim()) && Number(normalizedValue) === 0;
}
