-- ============================================================
-- FILA DE ANÚNCIOS — CONSERTAR "PENDENTE"
--
-- A fila nunca rodou uma vez sequer. Estado medido em 21/08/2026: ativa,
-- 959 produtos aguardando, `ultima_execucao` NULO e zero registros de erro.
-- Dois defeitos encadeados, e o segundo escondia o primeiro.
--
-- 1. A CONSULTA ERA INVÁLIDA. "Pendente" era expresso como
--    `.or('enviado_em.is.null,sujo_em.gt.enviado_em')`. O PostgREST não
--    compara duas COLUNAS entre si nesse filtro — ele lê `enviado_em` como
--    texto e tenta converter para data:
--        invalid input syntax for type timestamp: "enviado_em"
--    A rodada estourava na primeira consulta, toda vez.
--
-- 2. O ERRO NÃO CONSEGUIA SER REGISTRADO. O catch grava em
--    marketplace_sync_log com `canal_id: null` — mas a coluna era NOT NULL.
--    O log falhava junto, e o erro sumia sem rastro. Daí o quadro
--    enganoso: fila ativa, produtos parados, nenhum erro à vista.
--
-- A correção do (1) não é reescrever a comparação em SQL, e sim eliminar a
-- necessidade dela: quem enfileira passa a LIMPAR `enviado_em`. Assim
-- "pendente" vira `enviado_em IS NULL` — uma condição simples, que o
-- PostgREST entende e o índice cobre.
-- ============================================================


-- ── 1. Enfileirar limpa o envio anterior ────────────────────
--
-- Produto sujo de novo é produto por enviar, independente de já ter sido
-- enviado antes. `sujo_em` continua servindo para a ordem de atendimento
-- (mais antigo primeiro) e para auditoria.

CREATE OR REPLACE FUNCTION enfileirar_produto(
  p_empresa UUID, p_produto UUID, p_motivo TEXT, p_prioridade SMALLINT DEFAULT 0
) RETURNS void AS $$
BEGIN
  IF p_empresa IS NULL OR p_produto IS NULL THEN RETURN; END IF;

  INSERT INTO marketplace_fila (empresa_id, produto_id, sujo_em, motivo, prioridade)
  VALUES (p_empresa, p_produto, now(), p_motivo, p_prioridade)
  ON CONFLICT (empresa_id, produto_id) DO UPDATE SET
    sujo_em = now(),
    motivo  = EXCLUDED.motivo,
    -- Volta a contar como pendente: é isso que substitui a comparação
    -- entre colunas que o PostgREST não sabia fazer.
    enviado_em = NULL,
    -- Prioridade só sobe: se o produto já estava marcado como urgente, uma
    -- movimentação comum depois não pode rebaixá-lo.
    prioridade = GREATEST(marketplace_fila.prioridade, EXCLUDED.prioridade);
END;
$$ LANGUAGE plpgsql;


-- ── 2. Acertar quem já estava pendente ──────────────────────
-- Linhas sujas depois do último envio ficaram com enviado_em preenchido.
-- Sem isso elas sumiriam da fila em vez de serem enviadas.
UPDATE marketplace_fila
SET enviado_em = NULL
WHERE enviado_em IS NOT NULL AND sujo_em > enviado_em;


-- ── 3. Índice conforme a nova definição ─────────────────────
DROP INDEX IF EXISTS idx_fila_pendentes;
CREATE INDEX IF NOT EXISTS idx_fila_pendentes
  ON marketplace_fila (empresa_id, prioridade DESC, sujo_em)
  WHERE enviado_em IS NULL;


-- ── 4. Log de erro sem canal ────────────────────────────────
-- Falha da fila inteira não pertence a canal nenhum. Com a coluna NOT NULL,
-- justamente o erro mais importante era o que não conseguia ser gravado.
ALTER TABLE marketplace_sync_log ALTER COLUMN canal_id DROP NOT NULL;


-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FILTER (WHERE enviado_em IS NULL) AS pendentes,
--          count(*) AS total
--   FROM marketplace_fila;
--
--   SELECT ultima_execucao, simulacao FROM marketplace_fila_config;
