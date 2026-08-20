-- ============================================================
-- CADASTRO DE CLIENTE COMPLETO
--
-- O cadastro de cliente nunca teve tela de verdade: não havia como criar
-- um cliente pelo sistema (`from('clientes').insert` não existia em lugar
-- nenhum do código) e a única edição possível eram os campos financeiros.
-- Nome, telefone, e-mail e endereço só apareciam como texto.
--
-- As colunas de endereço do cliente (cep, logradouro, numero, complemento,
-- bairro, cidade, estado) JÁ EXISTEM na tabela — vieram da importação
-- inicial e nunca ganharam interface. Este arquivo não mexe nelas.
--
-- O que falta é o que não existe em lugar nenhum do schema:
--   · quem são as pessoas de contato do cliente, e quais podem comprar
--   · para onde entregar, quando não é o endereço do cadastro
--
-- Duas tabelas filhas no padrão de vendedor_empresas
-- (supabase-vendedores-saas.sql): FK com ON DELETE CASCADE e RLS
-- desligada, como o resto do domínio operacional.
-- ============================================================


-- ── 1. Pessoas do cliente ───────────────────────────────────
--
-- Caso que motivou: escritório com vários funcionários autorizados a
-- comprar em nome da firma. `autorizado_compra` é INFORMATIVO — o PDV
-- mostra quem está na lista ao escolher o cliente, mas não trava a venda
-- de quem não está. Travar o caixa por lista desatualizada custa mais caro
-- do que o controle vale.
--
-- `recebe_avisos` conversa com o aviso de compra por WhatsApp
-- (supabase-alerta-pedido-cliente.sql): além do número principal do
-- cliente, cada contato marcado aqui também recebe.

CREATE TABLE IF NOT EXISTS cliente_contatos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  cliente_id        UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

  nome              TEXT NOT NULL,
  cargo             TEXT,
  telefone          TEXT,
  email             TEXT,

  autorizado_compra BOOLEAN NOT NULL DEFAULT false,
  recebe_avisos     BOOLEAN NOT NULL DEFAULT false,

  observacao        TEXT,
  ativo             BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cliente_contatos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cliente_contatos_cliente ON cliente_contatos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cliente_contatos_empresa ON cliente_contatos(empresa_id);


-- ── 2. Endereços de entrega ─────────────────────────────────
--
-- Separados do endereço do cadastro porque um cliente entrega em obra,
-- filial ou depósito — e o endereço de cobrança continua sendo o da sede.

CREATE TABLE IF NOT EXISTS cliente_enderecos_entrega (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,

  apelido      TEXT,          -- "Obra Bangu", "Filial Centro"
  cep          TEXT,
  logradouro   TEXT,
  numero       TEXT,
  complemento  TEXT,
  bairro       TEXT,
  cidade       TEXT,
  estado       TEXT,
  referencia   TEXT,          -- ponto de referência para o entregador
  observacao   TEXT,

  padrao       BOOLEAN NOT NULL DEFAULT false,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cliente_enderecos_entrega DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cli_end_entrega_cliente ON cliente_enderecos_entrega(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cli_end_entrega_empresa ON cliente_enderecos_entrega(empresa_id);

-- No máximo um endereço padrão por cliente, garantido no banco — mesmo
-- recurso usado em depositos.principal, sem precisar de gatilho.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cli_end_entrega_padrao_unico
  ON cliente_enderecos_entrega(cliente_id) WHERE padrao;


-- ── 3. Entrega na venda ─────────────────────────────────────
--
-- Conserta um descarte silencioso: o modal F9 do PDV coleta logradouro,
-- número, bairro, cidade e observação da entrega, mas a venda só gravava
-- `entrega_solicitada` (um booleano). O endereço digitado pelo operador
-- morria junto com a tela, e quem ia entregar não tinha onde consultar.
--
-- Guarda os dois: o id para saber QUAL endereço foi escolhido, e o texto
-- para congelar como ele estava no dia. Endereço cadastrado pode ser
-- corrigido depois; uma venda antiga não pode mudar de endereço
-- retroativamente.

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS endereco_entrega_id UUID REFERENCES cliente_enderecos_entrega(id),
  ADD COLUMN IF NOT EXISTS endereco_entrega_texto TEXT;


-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FROM cliente_contatos;
--   SELECT count(*) FROM cliente_enderecos_entrega;
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'vendas' AND column_name LIKE 'endereco_entrega%';
