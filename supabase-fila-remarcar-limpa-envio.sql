-- ============================================================
-- FILA DE ANÚNCIOS — REMARCAR VOLTA A LIMPAR O ENVIO ANTERIOR
--
-- Aplicado em 06/10/2026.
--
-- A fila só atende `enviado_em IS NULL` (supabase-fila-pendente-consertar.sql,
-- 23/08). Para isso, quem enfileira precisa LIMPAR `enviado_em` ao remarcar
-- um produto que já foi enviado.
--
-- REGRESSÃO: supabase-corrigir-baixa-estoque-gatilho-fila.sql (03/09)
-- recriou enfileirar_produto copiando o corpo de ANTES de 23/08 — sem
-- `enviado_em = NULL`. Desde então, produto já enviado uma vez e alterado de
-- novo ficava com `sujo_em` novo e `enviado_em` velho: invisível para a fila.
--
-- MEDIDO EM 06/10/2026: 1.181 produtos represados (395 só na semana de
-- 28/09), 39 anúncios ativos com estoque zero no sistema ainda à venda —
-- caso que revelou: Luminária LED kit 3 e kit 6 no ML Eficaz, 0 no sistema,
-- 8 e 4 no ML.
--
-- Os dois arquivos antigos foram corrigidos também, para que reaplicá-los não
-- traga o defeito de volta; tests/marketplace/fila-sql.test.ts confere isso.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enfileirar_produto(
  p_empresa uuid, p_produto uuid, p_motivo text, p_prioridade smallint DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_empresa IS NULL OR p_produto IS NULL THEN RETURN; END IF;

  INSERT INTO marketplace_fila (empresa_id, produto_id, sujo_em, motivo, prioridade)
  VALUES (p_empresa, p_produto, now(), p_motivo, p_prioridade)
  ON CONFLICT (empresa_id, produto_id) DO UPDATE SET
    sujo_em = now(),
    motivo  = EXCLUDED.motivo,
    -- Pendente é `enviado_em IS NULL`: remarcar sem limpar deixava o produto
    -- invisível para a fila (regressão de 03/09/2026).
    enviado_em = NULL,
    -- Mudança nova, tentativas novas.
    tentativas = 0,
    prioridade = GREATEST(marketplace_fila.prioridade, EXCLUDED.prioridade);
END;
$function$;

-- Devolve à fila o que ficou represado.
UPDATE marketplace_fila
SET enviado_em = NULL, tentativas = 0
WHERE enviado_em IS NOT NULL AND sujo_em > enviado_em;

-- Zerados no sistema e ainda à venda vão na frente (aplicado à mão em
-- 06/10/2026: 19 produtos, 39 anúncios).
UPDATE marketplace_fila f SET prioridade = 2
WHERE f.enviado_em IS NULL AND EXISTS (
  SELECT 1 FROM produtos p JOIN marketplace_anuncios a ON a.produto_id = p.id
  WHERE p.id = f.produto_id AND COALESCE(p.estoque, 0) <= 0
    AND a.status = 'ativo' AND COALESCE(a.estoque_externo, 0) > 0);
