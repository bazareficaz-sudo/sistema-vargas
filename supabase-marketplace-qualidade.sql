-- Qualidade dos anúncios.
--
-- Os dados já existem em marketplace_anuncios.dados_brutos, mas a listagem
-- não carrega essa coluna de propósito: ela é ~85% do peso de cada linha, e
-- excluí-la deixou a tela de Anúncios 5x mais rápida. Por isso o resultado
-- do cálculo fica em colunas próprias — dá pra ordenar, filtrar e somar sem
-- trazer o JSON inteiro de 8.900 anúncios pro navegador.

ALTER TABLE marketplace_anuncios
  -- Índice oficial do Mercado Livre (0 a 1). NULL na Shopee, que não publica
  -- equivalente na API — e inventar um número e chamar de "nota Shopee"
  -- seria mentir sobre a origem do dado.
  ADD COLUMN IF NOT EXISTS qualidade_health NUMERIC,
  -- Nota do checklist do sistema (0 a 100), calculada dos mesmos critérios
  -- nas duas plataformas. É nossa, e a tela diz isso.
  ADD COLUMN IF NOT EXISTS qualidade_score INTEGER,
  -- Códigos do que falta (ex.: 'fotos', 'ean', 'video'). Array para dar pra
  -- perguntar "quais anúncios não têm EAN" direto no banco.
  ADD COLUMN IF NOT EXISTS qualidade_faltas TEXT[],
  ADD COLUMN IF NOT EXISTS qualidade_em TIMESTAMPTZ;

-- A pergunta que a tela faz o tempo todo é "os piores deste canal primeiro".
CREATE INDEX IF NOT EXISTS idx_anuncios_qualidade
  ON marketplace_anuncios (canal_id, qualidade_score);

-- E "quais anúncios têm esta falta" — GIN porque é busca dentro do array.
CREATE INDEX IF NOT EXISTS idx_anuncios_qualidade_faltas
  ON marketplace_anuncios USING GIN (qualidade_faltas);
