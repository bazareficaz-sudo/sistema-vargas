-- Base das faixas de saúde da precificação: margem (lucro ÷ preço) ou
-- lucro sobre o custo (lucro ÷ custo). Execute no Supabase → SQL Editor.
ALTER TABLE precificacao_config
  ADD COLUMN IF NOT EXISTS saude_base TEXT NOT NULL DEFAULT 'preco'
  CHECK (saude_base IN ('preco', 'custo'));
