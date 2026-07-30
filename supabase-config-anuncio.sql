-- Padrão de anúncios por empresa: as regras que o gestor escreve uma vez e
-- que passam a acompanhar TODO pedido de IA de anúncio (criar na Shopee,
-- criar no Mercado Livre e enriquecer o cadastro do produto).
--
-- É texto livre de propósito: a regra de cada loja é específica demais pra
-- caber num formulário de opções fixas, e o modelo entende instrução escrita.

CREATE TABLE IF NOT EXISTS empresa_config_anuncio (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  regra_titulo    TEXT,
  regra_descricao TEXT,
  tom_voz         TEXT,
  evitar          TEXT,
  atualizado_por  UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_anuncio DISABLE ROW LEVEL SECURITY;

-- Uma linha por empresa já existente, pra tela abrir preenchida com o padrão
-- que o sistema usa hoje (o gestor edita a partir daí em vez de começar do zero).
INSERT INTO empresa_config_anuncio (empresa_id, regra_titulo, regra_descricao, tom_voz, evitar)
SELECT
  e.id,
  'Comece pelo tipo do produto, não pela marca. Escreva tudo por extenso, sem abreviação ("com" no lugar de "c/", "para" no lugar de "p/"). Acentue corretamente. Primeira letra de cada palavra em maiúscula, conectivos em minúscula. Inclua um complemento que diferencie o anúncio: a aplicação, a forma de usar ou o formato do produto.',
  'Diga para que serve e em que situação se usa. Informe material, medidas e o que acompanha, quando isso estiver no cadastro. Escreva em 2 a 4 parágrafos curtos.',
  'Direto e prático, como quem explica pra um cliente no balcão.',
  'Emoji, CAIXA ALTA, palavra de propaganda vazia ("melhor", "imperdível", "promoção") e qualquer informação que não esteja no cadastro do produto.'
FROM empresas e
WHERE NOT EXISTS (SELECT 1 FROM empresa_config_anuncio c WHERE c.empresa_id = e.id);
