-- ============================================================
-- Frete real do Mercado Livre na precificação
--
-- Até agora o frete do ML era UM número digitado por canal ("custo médio
-- R$ 22"), aplicado a todo produto acima de R$ 79. Medido na conta de
-- produção, isso erra em dois eixos ao mesmo tempo:
--
--   por tamanho  — 300g custa R$ 16,15 e 20kg custa R$ 75,05;
--   por preço    — o MESMO pacote de 1kg custa R$ 18,45 a R$ 79,
--                  R$ 21,55 a R$ 100, R$ 24,65 a R$ 120 e R$ 30,75 de
--                  R$ 200 pra cima.
--
-- Ou seja: o frete é uma escada por faixa de preço, uma escada diferente
-- para cada tamanho de caixa. Um número só não tem como estar certo.
--
-- Esta tabela guarda a escada que a API do ML devolveu para uma combinação
-- de embalagem + tipo de logística. É cache: consultar a API a cada cálculo
-- seria lento e estouraria limite de requisição. Mesmo papel e mesmo
-- formato de precificacao_ml_comissao_cache.
-- ============================================================

CREATE TABLE IF NOT EXISTS precificacao_ml_frete_cache (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id       UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  -- Peso cobrável (g) que o ML calculou, já considerando o volumétrico
  -- (AxBxC/6000). É a chave certa em vez das medidas cruas: caixas
  -- diferentes que dão o mesmo peso cobrável pagam o mesmo frete, então
  -- compartilham a mesma linha de cache.
  peso_cobravel  INTEGER NOT NULL,
  logistic_type  TEXT NOT NULL,
  listing_type   TEXT NOT NULL,
  faixas         JSONB NOT NULL,   -- [{min,max,valor}] montado a partir da API
  buscado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canal_id, peso_cobravel, logistic_type, listing_type)
);

ALTER TABLE precificacao_ml_frete_cache DISABLE ROW LEVEL SECURITY;

-- Liga o frete importado por canal. Fica desligado por padrão: nenhuma
-- empresa tem o preço recalculado sozinha por causa desta migração.
ALTER TABLE precificacao_config
  ADD COLUMN IF NOT EXISTS frete_ml_importar BOOLEAN NOT NULL DEFAULT false;

-- Onde o anúncio guarda a embalagem que o ML usa para cobrar. Vem dos
-- atributos SELLER_PACKAGE_* do próprio anúncio — que é o que o ML olha,
-- não o que está no nosso cadastro de produto.
ALTER TABLE marketplace_anuncios
  ADD COLUMN IF NOT EXISTS frete_peso_cobravel INTEGER,
  ADD COLUMN IF NOT EXISTS frete_logistic_type TEXT,
  ADD COLUMN IF NOT EXISTS frete_atualizado_em TIMESTAMPTZ;
