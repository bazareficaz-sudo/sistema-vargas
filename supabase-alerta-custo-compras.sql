-- ═══════════════════════════════════════════════════════════════════════════
--  Alerta de variação de custo na entrada de mercadoria
--  Rodar no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Guarda, por empresa, a partir de quanto de AUMENTO de custo a linha do
--  produto deve ser destacada em vermelho na revisão de preços da entrada.
--
--  Fica em empresa_config_comercial (e não numa tabela nova) porque é uma
--  regra comercial da empresa, irmã de limite_desconto/margem_minima que já
--  moram ali.

ALTER TABLE empresa_config_comercial
  ADD COLUMN IF NOT EXISTS alerta_aumento_custo_ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alerta_aumento_custo_pct   NUMERIC(6,2) NOT NULL DEFAULT 5;

COMMENT ON COLUMN empresa_config_comercial.alerta_aumento_custo_pct IS
  'Percentual de aumento de custo a partir do qual a linha do produto é destacada na revisão de preços da entrada de mercadoria.';

-- Empresas que ainda não têm linha de configuração comercial passam a ter,
-- senão o alerta simplesmente não apareceria para elas.
INSERT INTO empresa_config_comercial (empresa_id)
SELECT e.id FROM empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM empresa_config_comercial c WHERE c.empresa_id = e.id
)
ON CONFLICT (empresa_id) DO NOTHING;
