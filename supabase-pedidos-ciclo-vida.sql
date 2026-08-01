-- ============================================================
-- Pedidos — Fase 2: ciclo de vida próprio e linha do tempo
--
-- A DECISÃO DE FUNDO, e o porquê:
--
-- Pedido de marketplace JÁ tem status vindo da Shopee e do Mercado Livre.
-- Criar um status nosso do lado gera a pergunta óbvia: qual vale?
--
-- A resposta adotada é que os dois valem, porque respondem coisas
-- diferentes:
--
--   status do canal  → o que o marketplace sabe   ("está pago", "foi entregue")
--   etapa (esta)     → o que o SEU galpão fez     ("já separei", "já embalei")
--
-- Um pedido pode estar "pago" no ML e ainda não ter sido separado aqui. É
-- justamente esse vão que a tela não mostrava.
--
-- Para os dois nunca divergirem na prática, a etapa AVANÇA sozinha quando o
-- canal informa envio ou entrega — e nunca retrocede. Quem separou, embalou
-- e despachou continua registrado.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ATENÇÃO a uma coluna que já existe: `marketplace_pedidos.etapa_interna`.
-- Ela é DERIVADA — a sincronização a recalcula sozinha a partir do status do
-- canal e do mapeamento dos itens ('pendencia_mapeamento', 'pronto_expedicao'
-- …), e qualquer coisa escrita nela é sobrescrita no próximo sync. Por isso a
-- coluna nova se chama `etapa_operacional`: é a que a PESSOA controla, e as
-- duas nunca devem ser confundidas.
--
-- Etapas: novo → separando → embalado → despachado → concluido
--         (+ cancelado, a qualquer momento)
--
-- Fica em cada tabela de origem, e não numa tabela nova de pedidos, porque
-- unificar as duas de verdade exigiria migrar 1.200 registros e mexer em
-- emissão fiscal e baixa de estoque no mesmo movimento.

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS etapa_operacional TEXT NOT NULL DEFAULT 'concluido',
  ADD COLUMN IF NOT EXISTS etapa_operacional_em TIMESTAMPTZ;

ALTER TABLE marketplace_pedidos
  ADD COLUMN IF NOT EXISTS etapa_operacional TEXT NOT NULL DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS etapa_operacional_em TIMESTAMPTZ;

-- Venda de balcão nasce concluída: o cliente já saiu com o produto na mão.
-- Não faz sentido pedir que alguém marque "separando" depois do fato.
-- Pedido de marketplace nasce 'novo' — esse sim precisa passar pelo galpão.

-- Pedido de marketplace que o canal já deu como enviado/entregue começa
-- despachado, senão a tela nasceria mentindo que há centenas a separar.
UPDATE marketplace_pedidos SET etapa_operacional = 'despachado'
 WHERE etapa_operacional = 'novo'
   AND (status IN ('enviado', 'entregue') OR data_envio IS NOT NULL OR etapa_interna IN ('enviado', 'concluido'));
UPDATE marketplace_pedidos SET etapa_operacional = 'cancelado' WHERE status = 'cancelado' AND etapa_operacional <> 'cancelado';
UPDATE vendas SET etapa_operacional = 'cancelado' WHERE status IN ('cancelada', 'cancelado') AND etapa_operacional <> 'cancelado';

-- ── Linha do tempo ──────────────────────────────────────────
--
-- Append-only: nunca se edita nem se apaga um evento. É o que permite
-- responder "quem marcou este pedido como despachado, e quando?" meses
-- depois — e é a base da auditoria da Fase 4.

CREATE TABLE IF NOT EXISTS pedido_eventos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL,

  -- Referência polimórfica: 'venda' aponta para vendas, 'marketplace' para
  -- marketplace_pedidos. Sem FK justamente por isso — a integridade é
  -- garantida na aplicação, que sempre confere a posse antes de gravar.
  fonte          TEXT NOT NULL CHECK (fonte IN ('venda', 'marketplace')),
  referencia_id  UUID NOT NULL,

  tipo           TEXT NOT NULL,          -- etapa | nota | envio | observacao | sistema
  etapa_anterior TEXT,
  etapa_nova     TEXT,
  descricao      TEXT NOT NULL,
  observacao     TEXT,

  -- Nulo quando o evento veio de rotina automática (sincronização do canal).
  usuario_id     UUID REFERENCES auth.users(id),
  usuario_nome   TEXT,
  automatico     BOOLEAN NOT NULL DEFAULT false,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pedido_eventos DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pedido_eventos_ref
  ON pedido_eventos(fonte, referencia_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedido_eventos_empresa
  ON pedido_eventos(empresa_id, created_at DESC);

-- ============================================================
-- COMO DESFAZER:
--
--   ALTER TABLE vendas              DROP COLUMN IF EXISTS etapa_operacional, DROP COLUMN IF EXISTS etapa_operacional_em;
--   ALTER TABLE marketplace_pedidos DROP COLUMN IF EXISTS etapa_operacional, DROP COLUMN IF EXISTS etapa_operacional_em;
--   DROP TABLE IF EXISTS pedido_eventos;
--
-- Nenhum dado existente é alterado além das colunas novas — status, valores
-- e itens dos pedidos ficam exatamente como estavam.
-- ============================================================
