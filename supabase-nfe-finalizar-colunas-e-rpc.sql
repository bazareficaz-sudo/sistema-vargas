-- ============================================================
-- Mais colunas que o código de Entrada por XML sempre referenciou mas
-- nunca existiram de verdade no banco (mesma causa da migration anterior,
-- supabase-nfe-itens-colunas-faltantes.sql) — dessa vez nas etapas de
-- Custos e Finalizar. Confirmado por teste direto: NENHUMA entrada deste
-- sistema jamais chegou a status='finalizada' de verdade no banco, porque
-- o update final sempre falhava nessas colunas (silenciosamente, antes da
-- checagem de erro que foi adicionada no código).
--
-- Também cria a função incrementar_estoque, que o código sempre chamou
-- via RPC mas nunca existiu — o fallback (update direto em produtos.estoque)
-- rodava no lugar dela, então o estoque agregado provavelmente já estava
-- sendo creditado certo, mas o estoque POR DEPÓSITO (produto_estoque,
-- usado no cálculo de kits) nunca era atualizado nessa hora.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS frete_adicional NUMERIC(10,2) DEFAULT 0;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS seguro_adicional NUMERIC(10,2) DEFAULT 0;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS outras_despesas_adicionais NUMERIC(10,2) DEFAULT 0;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS incluir_ipi_custo BOOLEAN DEFAULT true;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS incluir_st_custo BOOLEAN DEFAULT true;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS operador_finalizacao TEXT;
ALTER TABLE nfe_entradas ADD COLUMN IF NOT EXISTS data_finalizacao TIMESTAMPTZ;

ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS data_vencimento DATE;
ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS origem_id UUID;

ALTER TABLE nfe_logs ADD COLUMN IF NOT EXISTS detalhes TEXT;

CREATE OR REPLACE FUNCTION incrementar_estoque(
  p_produto_id UUID,
  p_empresa_id UUID,
  p_deposito_id UUID,
  p_quantidade NUMERIC,
  p_custo NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE produtos
  SET estoque = COALESCE(estoque, 0) + p_quantidade,
      preco_custo = p_custo,
      updated_at = now()
  WHERE id = p_produto_id AND empresa_id = p_empresa_id;

  INSERT INTO produto_estoque (empresa_id, deposito_id, produto_id, quantidade, ultima_movimentacao, updated_at)
  VALUES (p_empresa_id, p_deposito_id, p_produto_id, p_quantidade, now(), now())
  ON CONFLICT (empresa_id, deposito_id, produto_id)
  DO UPDATE SET
    quantidade = produto_estoque.quantidade + EXCLUDED.quantidade,
    ultima_movimentacao = now(),
    updated_at = now();
END;
$$ LANGUAGE plpgsql;
