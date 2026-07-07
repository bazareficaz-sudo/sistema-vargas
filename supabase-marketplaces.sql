-- ============================================================
-- MÓDULO MARKETPLACES
-- ============================================================

-- Canais de venda (instâncias de marketplace por empresa)
CREATE TABLE IF NOT EXISTS marketplace_canais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL,
  nome          TEXT NOT NULL,                  -- "Minha loja ML", "Shopee Vargas"
  plataforma    TEXT NOT NULL,                  -- mercadolivre | shopee | amazon | magalu | outro
  ativo         BOOLEAN NOT NULL DEFAULT true,
  -- Credenciais / tokens (armazenar criptografado em produção)
  client_id     TEXT,
  client_secret TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  token_expira_em TIMESTAMPTZ,
  seller_id     TEXT,                           -- ID do vendedor na plataforma
  -- Config
  markup_canal  NUMERIC(10,2) DEFAULT 0,        -- markup extra sobre preço base
  sincronizar_estoque BOOLEAN DEFAULT true,
  sincronizar_preco   BOOLEAN DEFAULT true,
  ultima_sincronizacao TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketplace_canais DISABLE ROW LEVEL SECURITY;

-- Anúncios: vínculo produto ↔ canal
CREATE TABLE IF NOT EXISTS marketplace_anuncios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  canal_id          UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  produto_id        UUID REFERENCES produtos(id) ON DELETE SET NULL,
  -- Dados do anúncio
  titulo            TEXT NOT NULL,
  descricao         TEXT,
  preco_venda       NUMERIC(10,2) NOT NULL DEFAULT 0,
  preco_promocional NUMERIC(10,2),
  promo_inicio      DATE,
  promo_fim         DATE,
  estoque_reservado INTEGER DEFAULT 0,       -- estoque alocado para este canal
  -- IDs externos
  id_externo        TEXT,                    -- ID do anúncio na plataforma
  url_anuncio       TEXT,
  sku_canal         TEXT,
  -- Status
  status            TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | ativo | pausado | encerrado | erro
  status_externo    TEXT,                              -- status retornado pela API
  erro_msg          TEXT,
  -- Sync
  ultima_atualizacao TIMESTAMPTZ,
  sincronizado_em   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketplace_anuncios DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_anuncios_canal ON marketplace_anuncios(canal_id);
CREATE INDEX IF NOT EXISTS idx_anuncios_produto ON marketplace_anuncios(produto_id);

-- Pedidos vindos dos marketplaces
CREATE TABLE IF NOT EXISTS marketplace_pedidos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  canal_id        UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  -- IDs externos
  id_externo      TEXT NOT NULL,            -- ID do pedido na plataforma
  numero_pedido   TEXT,
  -- Cliente
  cliente_nome    TEXT,
  cliente_email   TEXT,
  cliente_doc     TEXT,
  -- Endereço entrega
  entrega_cep     TEXT,
  entrega_logradouro TEXT,
  entrega_numero  TEXT,
  entrega_bairro  TEXT,
  entrega_cidade  TEXT,
  entrega_estado  TEXT,
  -- Valores
  valor_produtos  NUMERIC(10,2) DEFAULT 0,
  valor_frete     NUMERIC(10,2) DEFAULT 0,
  valor_desconto  NUMERIC(10,2) DEFAULT 0,
  valor_total     NUMERIC(10,2) DEFAULT 0,
  -- Status
  status          TEXT NOT NULL DEFAULT 'novo',
  -- novo | confirmado | faturado | enviado | entregue | cancelado | devolvido
  status_externo  TEXT,
  data_pedido     TIMESTAMPTZ,
  data_pagamento  TIMESTAMPTZ,
  data_envio      TIMESTAMPTZ,
  data_entrega    TIMESTAMPTZ,
  -- Frete
  transportadora  TEXT,
  codigo_rastreio TEXT,
  -- Notas
  observacoes     TEXT,
  baixou_estoque  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (canal_id, id_externo)
);
ALTER TABLE marketplace_pedidos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pedidos_canal ON marketplace_pedidos(canal_id);

-- Itens dos pedidos
CREATE TABLE IF NOT EXISTS marketplace_pedido_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES marketplace_pedidos(id) ON DELETE CASCADE,
  anuncio_id      UUID REFERENCES marketplace_anuncios(id) ON DELETE SET NULL,
  produto_id      UUID REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto    TEXT NOT NULL,
  sku             TEXT,
  quantidade      INTEGER NOT NULL DEFAULT 1,
  preco_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0
);
ALTER TABLE marketplace_pedido_itens DISABLE ROW LEVEL SECURITY;

-- Log de sincronizações
CREATE TABLE IF NOT EXISTS marketplace_sync_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id    UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,   -- estoque | preco | anuncio | pedido | auth
  status      TEXT NOT NULL,   -- ok | erro
  mensagem    TEXT,
  detalhes    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE marketplace_sync_log DISABLE ROW LEVEL SECURITY;
