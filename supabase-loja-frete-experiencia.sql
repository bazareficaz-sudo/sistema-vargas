-- Loja Online: como a loja pergunta "para onde entregamos?" ao cliente.
--
-- O cálculo do frete já existe (supabase-loja-frete.sql). Isto só acrescenta,
-- na configuração da loja, as escolhas do gestor sobre a EXPERIÊNCIA do
-- cliente: quando a janela de bairro abre, o que ela pede, onde o frete
-- aparece. Nenhuma regra de preço muda.
--
-- Idempotente.

ALTER TABLE loja_frete_config
  -- Quando a janela "Para onde entregamos?" abre sozinha:
  --   entrada  → na primeira visita à loja
  --   produto  → quando o cliente pede o frete de um produto (padrão)
  --   carrinho → ao abrir o carrinho
  --   nunca    → só quando o cliente clica em "Entregar em…"
  ADD COLUMN IF NOT EXISTS seletor_gatilho       TEXT    NOT NULL DEFAULT 'produto',
  -- O que o cliente informa: escolher o bairro numa lista, digitar o CEP, ou os dois.
  ADD COLUMN IF NOT EXISTS seletor_identificacao TEXT    NOT NULL DEFAULT 'ambos',
  ADD COLUMN IF NOT EXISTS seletor_titulo        TEXT,
  -- Faixa fixa no topo: "Entregar em: Bairro X · Trocar".
  ADD COLUMN IF NOT EXISTS faixa_topo            BOOLEAN NOT NULL DEFAULT true,
  -- Bloco "Calcular frete" na página do produto.
  ADD COLUMN IF NOT EXISTS mostrar_no_produto    BOOLEAN NOT NULL DEFAULT true,
  -- "Faltam R$ X para frete grátis" no carrinho e na página do produto.
  ADD COLUMN IF NOT EXISTS incentivo_gratis      BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE loja_frete_config DROP CONSTRAINT IF EXISTS loja_frete_config_gatilho_chk;
ALTER TABLE loja_frete_config ADD CONSTRAINT loja_frete_config_gatilho_chk
  CHECK (seletor_gatilho IN ('entrada', 'produto', 'carrinho', 'nunca'));

ALTER TABLE loja_frete_config DROP CONSTRAINT IF EXISTS loja_frete_config_identificacao_chk;
ALTER TABLE loja_frete_config ADD CONSTRAINT loja_frete_config_identificacao_chk
  CHECK (seletor_identificacao IN ('bairro', 'cep', 'ambos'));

NOTIFY pgrst, 'reload schema';

-- COMO DESFAZER
--   ALTER TABLE loja_frete_config
--     DROP COLUMN seletor_gatilho, DROP COLUMN seletor_identificacao,
--     DROP COLUMN seletor_titulo, DROP COLUMN faixa_topo,
--     DROP COLUMN mostrar_no_produto, DROP COLUMN incentivo_gratis;
