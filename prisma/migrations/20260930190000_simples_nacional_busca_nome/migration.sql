-- Busca por nome/razao social na tabela do Simples Nacional (dezenas de milhoes de linhas).
-- Indice de texto completo por palavra (sem extensoes), ignorando acentos e maiusculas.
-- O Prisma nao representa indices por expressao: nao remover este indice em migrations futuras.
-- Com a tabela ja carregada (base nacional), a criacao do indice leva alguns minutos; mais memoria acelera o GIN.
SET maintenance_work_mem = '256MB';

CREATE OR REPLACE FUNCTION simples_nacional_nome_tsvector(nome TEXT)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple'::regconfig,
    lower(translate(
      coalesce(nome, ''),
      'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝáàâãäåéèêëíìîïóòôõöúùûüçñý',
      'AAAAAAEEEEIIIIOOOOOUUUUCNYaaaaaaeeeeiiiiooooouuuucny'
    ))
  )
$$;

CREATE INDEX "simples_nacional_empresas_razao_social_busca_idx"
  ON "simples_nacional_empresas"
  USING GIN (simples_nacional_nome_tsvector("razao_social"))
  WHERE "razao_social" IS NOT NULL;
