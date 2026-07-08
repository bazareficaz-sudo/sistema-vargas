-- ============================================================
-- MELHORIAS NO MÓDULO DE ENTRADAS DE MERCADORIA
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. NUMERAÇÃO SEQUENCIAL (ENT-000001)
ALTER TABLE entradas
  ADD COLUMN IF NOT EXISTS numero_entrada  TEXT,
  ADD COLUMN IF NOT EXISTS status_revisao  TEXT DEFAULT 'pendente';
  -- status_revisao: pendente | em_revisao | revisado | dispensado

-- Preenche registros existentes com numeração sequencial por empresa
WITH numbered AS (
  SELECT id,
    'ENT-' || LPAD(ROW_NUMBER() OVER (PARTITION BY empresa_id ORDER BY created_at)::TEXT, 6, '0') AS num
  FROM entradas
  WHERE numero_entrada IS NULL
)
UPDATE entradas e SET numero_entrada = n.num FROM numbered n WHERE e.id = n.id;

-- Função geradora de número sequencial
CREATE OR REPLACE FUNCTION gerar_numero_entrada(p_empresa_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  proximo  INT;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(numero_entrada FROM 5) AS INT)), 0
  ) + 1
  INTO proximo
  FROM entradas
  WHERE empresa_id = p_empresa_id AND numero_entrada IS NOT NULL;

  RETURN 'ENT-' || LPAD(proximo::TEXT, 6, '0');
END;
$$;

-- Trigger: gera numero_entrada automaticamente no INSERT
CREATE OR REPLACE FUNCTION trg_set_numero_entrada()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero_entrada IS NULL THEN
    NEW.numero_entrada := gerar_numero_entrada(NEW.empresa_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_numero_entrada ON entradas;
CREATE TRIGGER tr_numero_entrada
  BEFORE INSERT ON entradas
  FOR EACH ROW EXECUTE FUNCTION trg_set_numero_entrada();

-- Índice para busca por numero_entrada
CREATE INDEX IF NOT EXISTS idx_entradas_numero ON entradas(numero_entrada);
CREATE INDEX IF NOT EXISTS idx_entradas_status_revisao ON entradas(status_revisao);

-- 2. HISTÓRICO DE ALTERAÇÃO DE PREÇOS
CREATE TABLE IF NOT EXISTS historico_precos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  produto_id            UUID NOT NULL,
  produto_nome          TEXT,
  produto_sku           TEXT,
  entrada_id            UUID REFERENCES entradas(id) ON DELETE SET NULL,
  numero_entrada        TEXT,
  numero_nf             TEXT,
  fornecedor_id         UUID,
  fornecedor_nome       TEXT,
  preco_venda_anterior  NUMERIC(10,2),
  preco_venda_novo      NUMERIC(10,2),
  custo_anterior        NUMERIC(10,2),
  custo_novo            NUMERIC(10,2),
  margem_anterior       NUMERIC(5,2),
  margem_nova           NUMERIC(5,2),
  variacao_custo_pct    NUMERIC(5,2),
  usuario_nome          TEXT,
  motivo                TEXT DEFAULT 'Revisão pela entrada de mercadoria',
  created_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE historico_precos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_historico_precos_produto  ON historico_precos(produto_id);
CREATE INDEX IF NOT EXISTS idx_historico_precos_entrada  ON historico_precos(entrada_id);
CREATE INDEX IF NOT EXISTS idx_historico_precos_empresa  ON historico_precos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_historico_precos_data     ON historico_precos(created_at DESC);

-- 3. CONTAGEM DE ITENS (view auxiliar para listagem)
CREATE OR REPLACE VIEW v_entradas_resumo AS
SELECT
  e.id,
  e.empresa_id,
  e.numero_entrada,
  e.numero_nf,
  e.serie,
  e.fornecedor_id,
  e.data_emissao,
  e.data_entrada,
  e.valor_produtos,
  e.valor_frete,
  e.valor_desconto,
  e.valor_outros,
  e.valor_total,
  e.status,
  e.status_revisao,
  e.observacoes,
  e.created_at,
  COUNT(ei.id) AS qtd_itens,
  SUM(ei.subtotal) AS total_itens
FROM entradas e
LEFT JOIN entrada_itens ei ON ei.entrada_id = e.id
GROUP BY e.id;
