-- ============================================================
-- FASE 1 — varredura diária de anúncios, retomável e visível
--
-- ── O problema medido (10/08/2026) ──────────────────────────
--
-- Canais conectados: 2 Mercado Livre, 2 Shopee. 8.736 anúncios no sistema.
--
--   ML Eficaz  · última sincronização: hoje
--   ML Ouro    · última sincronização: hoje
--   Shp Ouro   · última sincronização: 07/08  ← 3 dias atrás
--   Shp Eficaz · última sincronização: 08/08  ← 2 dias atrás
--
-- O Mercado Livre anda porque tem cursor (`ml_scan_scroll_id`): cada rodada
-- continua de onde a anterior parou. A Shopee não tem — `listItemIds` sempre
-- começa do offset 0 e para nos 500 primeiros itens. Ou seja: o cron da
-- Shopee reimportava os mesmos 500 anúncios todo dia, e os outros ~8.000
-- nunca eram atualizados. Não era só o timeout de 300s da Vercel: mesmo
-- rodando até o fim, ele nunca sairia do começo.
--
-- E quando ele morria por timeout, morria ANTES de gravar o log — então a
-- tela de sincronização não mostrava erro nenhum. Falha silenciosa há dias.
--
-- ── O que estas colunas resolvem ────────────────────────────
--
-- 1. Cursor por canal, de qualquer plataforma (JSONB, formato livre por
--    plataforma): a varredura para no meio e continua na rodada seguinte.
-- 2. Estado da passagem: dá pra ver se uma varredura está em andamento,
--    quando começou, quantos itens já andou.
--
-- Nada aqui envia dado para marketplace nenhum. A Fase 1 é só leitura.
-- ============================================================

ALTER TABLE marketplace_canais
  ADD COLUMN IF NOT EXISTS varredura_status      TEXT,
  ADD COLUMN IF NOT EXISTS varredura_cursor      JSONB,
  ADD COLUMN IF NOT EXISTS varredura_iniciada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS varredura_ultimo_em   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS varredura_concluida_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS varredura_itens       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS varredura_rodadas     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS varredura_erro        TEXT;

COMMENT ON COLUMN marketplace_canais.varredura_status IS
  'em_andamento | concluida | erro. NULL = nunca varrido.';
COMMENT ON COLUMN marketplace_canais.varredura_cursor IS
  'Onde a varredura parou. Shopee: {"statusIdx":n,"offset":n}. Mercado Livre: {"scrollId":"..."}.';
COMMENT ON COLUMN marketplace_canais.varredura_itens IS
  'Itens processados na passagem ATUAL (zera a cada nova passagem).';
COMMENT ON COLUMN marketplace_canais.varredura_rodadas IS
  'Quantas invocações de cron a passagem atual consumiu. Alto = catálogo grande ou API lenta.';

CREATE INDEX IF NOT EXISTS idx_canais_varredura
  ON marketplace_canais (varredura_status)
  WHERE varredura_status = 'em_andamento';


-- ── Conferência ─────────────────────────────────────────────

SELECT nome, plataforma,
       ultima_sincronizacao::date AS ultima_sync,
       varredura_status, varredura_itens
FROM marketplace_canais
WHERE access_token IS NOT NULL
ORDER BY plataforma, nome;
