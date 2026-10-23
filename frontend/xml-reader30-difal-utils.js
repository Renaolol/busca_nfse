function parseXmlReader30Rate(value) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFourPercent(rate) {
  return Math.abs(rate - 4) < 0.005;
}

function resolveXmlReader30DifalRate(item) {
  const rates = [parseXmlReader30Rate(item?.aliquotaInterRaw), parseXmlReader30Rate(item?.aliquotaIcmsRaw)];
  return rates.find(isFourPercent) ?? rates.find((rate) => rate > 0) ?? 0;
}

function isXmlReader30DifalIcms4(item) {
  return isFourPercent(resolveXmlReader30DifalRate(item));
}

function resolveXmlReader30DifalBase(item) {
  const aliquotaInter = parseXmlReader30Rate(item?.aliquotaInterRaw);
  const baseInter = parseXmlReader30Rate(item?.baseCalculoInterRaw);
  if (isFourPercent(aliquotaInter) && baseInter > 0) {
    return baseInter;
  }

  return parseXmlReader30Rate(item?.baseCalculoIcmsRaw);
}

function resolveXmlReader30DifalIcms4Amount(item) {
  const aliquotaIcms = parseXmlReader30Rate(item?.aliquotaIcmsRaw);
  if (isFourPercent(aliquotaIcms)) {
    return parseXmlReader30Rate(item?.valorIcmsRaw);
  }

  const baseCalculo = resolveXmlReader30DifalBase(item);
  return Math.round((baseCalculo * 0.04 + Number.EPSILON) * 100) / 100;
}

export {
  isXmlReader30DifalIcms4,
  resolveXmlReader30DifalBase,
  resolveXmlReader30DifalIcms4Amount,
  resolveXmlReader30DifalRate
};
