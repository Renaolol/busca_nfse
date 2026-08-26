function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isXmlReader30DocumentCancelled(item) {
  if (!item) {
    return false;
  }

  const raw = item.raw && typeof item.raw === 'object' ? item.raw : {};
  const normalizedStatus = normalizeSearchText(
    [
      item.cancelada,
      item.dataCancelamento,
      item.nfCancelada,
      item.statusFiscal,
      item.statusLabel,
      item.status,
      item.eventosResumo,
      raw.cancelada,
      raw.dataCancelamento,
      raw.statusFiscal,
      raw.statusLabel,
      raw.status,
      raw.eventosResumo
    ]
      .filter(Boolean)
      .join(' ')
  );

  return normalizedStatus.includes('cancel');
}

function shouldIncludeDocumentValueInSum(item) {
  if (!item || isXmlReader30DocumentCancelled(item)) {
    return false;
  }

  const normalizedStatus = normalizeSearchText(item.statusFiscal || item.statusLabel || item.status || '');
  return normalizedStatus.includes('autoriz');
}

export {
  isXmlReader30DocumentCancelled,
  shouldIncludeDocumentValueInSum
};
