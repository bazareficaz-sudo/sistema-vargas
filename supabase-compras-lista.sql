-- ============================================================
-- LISTA DE COMPRA — Auxiliar de Compras (fatia 4)
--
-- O elo entre "o motor sugeriu" e "o pedido saiu para o fornecedor".
--
-- Por que precisa de um passo no meio: as sugestões do Auxiliar não têm
-- fornecedor fixado (um produto pode ter 2-3 históricos) e um pedido de
-- compra é sempre de UM fornecedor. Selecionar 40 produtos de 5
-- fornecedores diferentes precisa virar 5 pedidos, não 1 — a lista é onde
-- essa separação acontece, revisável antes de gerar.
--
-- Uma lista pode ficar aberta por dias (o comprador junta sugestões aos
-- poucos, revisa quantidade, troca fornecedor) até decidir gerar os
-- pedidos. Depois de gerados, os itens saem da lista — a lista não é um
-- histórico, é uma bancada de montagem.
-- ============================================================

CREATE TABLE IF NOT EXISTS compras_listas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  nome       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'aberta',   -- aberta | finalizada
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE compras_listas DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_compras_listas_empresa
  ON compras_listas (empresa_id, status);

CREATE TABLE IF NOT EXISTS compras_lista_itens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_id      UUID NOT NULL REFERENCES compras_listas(id) ON DELETE CASCADE,
  produto_id    UUID NOT NULL,
  quantidade    NUMERIC(14,4) NOT NULL DEFAULT 0,

  -- Nulo até o comprador escolher (ou o sistema sugerir e o comprador
  -- confirmar). Um item sem fornecedor não pode virar pedido — fica
  -- esperando na tela em vez de travar tudo o resto.
  fornecedor_id UUID,

  custo_unitario_estimado NUMERIC(14,4),
  observacao    TEXT,

  -- De onde veio: mostra ao comprador por que o item está aqui, e separa
  -- do que as Regras de Reposição das automações já criam sozinhas.
  origem        TEXT NOT NULL DEFAULT 'auxiliar',   -- auxiliar | manual
  motivo        TEXT,

  -- Preenchido quando o item é convertido — o item continua existindo
  -- (não é apagado) até a lista ser arquivada, para dar rastro de qual
  -- pedido nasceu daqui.
  pedido_compra_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE compras_lista_itens DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_compras_lista_itens_lista
  ON compras_lista_itens (lista_id);
CREATE INDEX IF NOT EXISTS idx_compras_lista_itens_produto
  ON compras_lista_itens (produto_id);

COMMENT ON TABLE compras_listas IS
  'Bancada de montagem entre a sugestão do Auxiliar e o pedido ao fornecedor. Fica aberta enquanto o comprador ajusta; os itens somem daqui quando viram pedido.';
