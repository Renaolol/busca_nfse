DROP INDEX "nfe_manifestacoes_one_inflight_event_idx";
CREATE UNIQUE INDEX "nfe_manifestacoes_one_inflight_event_idx"
    ON "nfe_manifestacoes"("nfe_documento_id", "tipo_evento")
    WHERE "status" = 'enviando';

DROP INDEX "nfe_manifestacoes_ciencia_unica_ativa_idx";
CREATE UNIQUE INDEX "nfe_manifestacoes_ciencia_unica_ativa_idx"
    ON "nfe_manifestacoes"("nfe_documento_id", "tipo_evento")
    WHERE "tipo_evento" = '210210'
      AND "status" IN ('enviando', 'registrada', 'registrada_sem_vinculo');
