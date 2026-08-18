-- ============================================================
-- PRÓXIMO SKU — corrigir geração duplicada
--
-- A função que sugere o próximo SKU lia `produtos` com .limit(50000) pra
-- achar o maior número já usado. Só que o PostgREST corta em 1000 linhas
-- por padrão, e `.limit()` do cliente não levanta esse teto: numa empresa
-- com 14 mil produtos, ela via só 1000 linhas ARBITRÁRIAS e calculava o
-- máximo em cima delas.
--
-- Resultado medido na Ouro e Prata (18/08/2026): a função devolvia sempre
-- 25618, quando o próximo livre era 25647 — por isso três produtos
-- diferentes nasceram com o mesmo SKU 25618.
--
-- Esta função resolve no banco, onde o MAX é uma conta só e não depende de
-- trazer linha nenhuma pra aplicação. O filtro por regex garante que só
-- SKUs puramente numéricos entrem na conta (os alfanuméricos continuam
-- válidos, só não participam da sequência), e o limite de tamanho evita
-- estourar o BIGINT com algum código longo digitado à mão.
-- ============================================================

CREATE OR REPLACE FUNCTION proximo_sku_numerico(p_empresa_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT (COALESCE(MAX(sku::BIGINT), 0) + 1)::TEXT
  FROM produtos
  WHERE empresa_id = p_empresa_id
    AND sku ~ '^[0-9]+$'
    AND length(sku) <= 18
$$;

-- ── Conferência ──────────────────────────────────────────────
--   SELECT proximo_sku_numerico('681ab72f-fd5b-4de9-8623-59eeb32e6d18'); -- Ouro e Prata
--   SELECT proximo_sku_numerico('a1000000-0000-0000-0000-000000000001'); -- Bazar Eficaz
