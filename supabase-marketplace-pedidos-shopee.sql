-- ============================================================
-- CENTRAL DE PEDIDOS — Fase 1 (fundação) — integração real Shopee
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. marketplace_pedidos: `status` continua representando o ciclo comercial
--    (novo|confirmado|faturado|enviado|entregue|cancelado|devolvido, já
--    existente, usado pelo fluxo manual). `etapa_interna` é uma dimensão
--    NOVA e ortogonal: fulfillment operacional (mapeamento/separação/
--    expedição). Um pedido pode estar "confirmado" comercialmente e
--    "pendencia_mapeamento" operacionalmente ao mesmo tempo — por isso não
--    reaproveitamos `status` para isso.
ALTER TABLE marketplace_pedidos
  ADD COLUMN IF NOT EXISTS etapa_interna TEXT NOT NULL DEFAULT 'novo',
  -- novo | pendencia_mapeamento | separacao | pronto_expedicao | enviado | concluido | cancelado | com_pendencia
  ADD COLUMN IF NOT EXISTS pendencia_motivo TEXT,
  ADD COLUMN IF NOT EXISTS prazo_postagem TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dados_brutos JSONB,
  ADD COLUMN IF NOT EXISTS ultima_sincronizacao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erro_sincronizacao TEXT,
  ADD COLUMN IF NOT EXISTS nfe_numero TEXT,
  ADD COLUMN IF NOT EXISTS nfe_chave TEXT,
  ADD COLUMN IF NOT EXISTS nfe_informada_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pedidos_dados_brutos_gin ON marketplace_pedidos USING GIN (dados_brutos);

-- 2. marketplace_pedido_itens: IDs externos da Shopee (item_id/model_id) pra
--    resolver o vínculo com marketplace_anuncios/marketplace_anuncio_variacoes
--    (FK direta, não via marketplace_mapeamentos — essa é keyed por SKU-texto
--    e serve só ao aprendizado do sync de catálogo). status_mapeamento é uma
--    cópia rápida do estado de produto_id, pra filtrar sem join. baixou_estoque
--    é por item (mais correto que o agregado por pedido, que continua
--    existindo só como flag de conveniência).
ALTER TABLE marketplace_pedido_itens
  ADD COLUMN IF NOT EXISTS item_id_externo TEXT,
  ADD COLUMN IF NOT EXISTS model_id_externo TEXT,
  ADD COLUMN IF NOT EXISTS status_mapeamento TEXT NOT NULL DEFAULT 'mapeado',
  -- 'pendente' | 'mapeado' — pedidos lançados manualmente (produto_id nunca
  -- setado pelo fluxo antigo) entram como 'mapeado' por padrão pra não virar
  -- pendência retroativa; a sincronização Shopee sempre seta o valor real.
  ADD COLUMN IF NOT EXISTS baixou_estoque BOOLEAN NOT NULL DEFAULT false;

-- Índice único por expressão: evita duplicidade em re-sync sem sofrer com
-- NULL em UNIQUE constraint normal (nem todo item tem variação/model_id).
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_pedido_itens_externo_uniq
  ON marketplace_pedido_itens (pedido_id, item_id_externo, COALESCE(model_id_externo, ''))
  WHERE item_id_externo IS NOT NULL;

-- 3. Pacotes/volumes — um pedido pode ter mais de um pacote na Shopee.
--    Sem geração/download de etiqueta nesta fase, só estrutura + preenchimento
--    na importação (evita nova migration quando a Fase 6 for implementada).
CREATE TABLE IF NOT EXISTS marketplace_pedido_pacotes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id             UUID NOT NULL REFERENCES marketplace_pedidos(id) ON DELETE CASCADE,
  package_number_externo TEXT,
  transportadora        TEXT,
  codigo_rastreio       TEXT,
  status_etiqueta       TEXT,
  dados_brutos          JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE marketplace_pedido_pacotes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pedido_pacotes_pedido ON marketplace_pedido_pacotes(pedido_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_pedido_pacotes_externo_uniq
  ON marketplace_pedido_pacotes (pedido_id, package_number_externo)
  WHERE package_number_externo IS NOT NULL;

-- 4. marketplace_canais: depósito responsável pela baixa de estoque desse
--    canal (nullable — vazio cai no comportamento atual, produtos.estoque
--    direto) + controle de sincronização de pedidos, separado do de catálogo.
ALTER TABLE marketplace_canais
  ADD COLUMN IF NOT EXISTS deposito_id UUID REFERENCES depositos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ultima_sincronizacao_pedidos TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intervalo_sincronizacao_pedidos_min INTEGER NOT NULL DEFAULT 1440;
  -- 1440 = 1x/dia. No plano Hobby da Vercel o cron só roda 1x/dia de
  -- qualquer forma; este campo já fica pronto para quando o plano permitir
  -- rodar com mais frequência.

-- 5. marketplace_sync_log: sem alteração de schema — reutiliza tipo/status/
--    mensagem/detalhes já existentes. Convenção de valor para `tipo`
--    introduzido por esta fase: 'sync_pedidos'.
