-- ============================================================
-- FALTAS E ENCOMENDAS — base do Auxiliar de Compras (fatia 0)
--
-- A tabela `faltas` já existe e o PDV do balcão já grava nela há duas
-- semanas. O problema não é falta de tabela — é que o que chega nela vem
-- truncado, e não há como separar "o cliente perguntou" de "o cliente
-- encomendou".
--
-- Medido em 17/08/2026, nos 11 registros existentes:
--   quantidade_solicitada = 1 em todos      (a tela manda `quantidade`,
--                                            o gravador lê `quantidade_solicitada`)
--   cliente_telefone      = nulo em todos   (a tela manda `cliente_whatsapp`)
--   usuario_nome          = nulo em todos   (nunca é enviado)
--   nenhuma coluna separa falta de encomenda
--
-- Este arquivo abre espaço para o dado certo. Os três bugs são corrigidos
-- do lado do PDV, no mesmo commit.
--
-- SOBRE RLS: continua DESLIGADA nesta tabela, de propósito. O PDV externo
-- fala com o banco pela chave anônima, sem sessão (supabaseClient.js).
-- Ligar RLS aqui hoje faria o vendedor perder a anotação no meio do
-- expediente. `faltas` já está na lista das 13 tabelas que esperam o
-- terminal autenticar de verdade — ver supabase-fechar-acesso-publico-2.sql.
-- Fechar isso é uma rodada própria, não um efeito colateral desta.
-- ============================================================

-- ── Falta × encomenda ────────────────────────────────────────
-- A diferença que mais importa para compras: falta é um sinal de demanda;
-- encomenda é um cliente esperando, com nome, e não pode se perder numa
-- lista genérica de reposição.
ALTER TABLE faltas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'falta';

DO $$ BEGIN
  ALTER TABLE faltas ADD CONSTRAINT faltas_tipo_check
    CHECK (tipo IN ('falta', 'encomenda'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN faltas.tipo IS
  'falta = cliente procurou e não tinha. encomenda = cliente pediu para comprar, tem intenção concreta.';

-- ── Quem anotou e de onde ────────────────────────────────────
-- Sem isso não dá para voltar ao vendedor e perguntar "o cliente ainda
-- quer?", nem para saber se a demanda é de uma loja ou de outra.
ALTER TABLE faltas
  ADD COLUMN IF NOT EXISTS usuario_id   UUID,
  ADD COLUMN IF NOT EXISTS deposito_id  UUID,
  ADD COLUMN IF NOT EXISTS terminal_id  TEXT;

-- ── O que a encomenda precisa carregar ───────────────────────
ALTER TABLE faltas
  ADD COLUMN IF NOT EXISTS prazo_desejado  DATE,
  ADD COLUMN IF NOT EXISTS preco_negociado NUMERIC(14,2);

-- ── O ciclo da solicitação ───────────────────────────────────
-- `quantidade_atendida` permite fechar parcialmente: o cliente pediu 10,
-- chegaram 6. Sem ela, a única saída seria marcar como resolvida uma
-- solicitação que ainda tem 4 unidades pendentes.
ALTER TABLE faltas
  ADD COLUMN IF NOT EXISTS quantidade_atendida NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pedido_compra_id    UUID,
  ADD COLUMN IF NOT EXISTS resolvido_em        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolvido_por       TEXT;

-- Vocabulário de status usado daqui para frente:
--
--   pendente    anotada, ninguém do lado da compra olhou ainda
--   em_analise  o comprador viu e está avaliando
--   em_compra   entrou numa lista de compra
--   pedido      virou pedido ao fornecedor
--   recebido    a mercadoria chegou — dá para avisar o cliente
--   atendido    o cliente levou
--   cancelado   não vamos comprar
--
-- DE PROPÓSITO sem CHECK: as linhas antigas usam `notificado`, `comprado`,
-- `resolvido` e `ignorado`, e o PDV instalado nos terminais ainda grava
-- esses valores. Um CHECK aqui quebraria o caixa antes da próxima
-- atualização do terminal chegar. As duas listas convivem.
COMMENT ON COLUMN faltas.status IS
  'pendente | em_analise | em_compra | pedido | recebido | atendido | cancelado. Valores antigos ainda aceitos: notificado, comprado, resolvido, ignorado.';

-- ── Índices ──────────────────────────────────────────────────
-- A tela do Auxiliar sempre pergunta a mesma coisa: o que está aberto
-- nesta empresa, agrupado por produto, do mais recente para o mais antigo.
CREATE INDEX IF NOT EXISTS idx_faltas_empresa_status
  ON faltas (empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_faltas_empresa_criado
  ON faltas (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_faltas_produto
  ON faltas (produto_id) WHERE produto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_faltas_tipo
  ON faltas (empresa_id, tipo, status);
CREATE INDEX IF NOT EXISTS idx_faltas_pedido_compra
  ON faltas (pedido_compra_id) WHERE pedido_compra_id IS NOT NULL;

-- ── updated_at ───────────────────────────────────────────────
-- A coluna existe mas ninguém a preenchia. O PDV usa `created_at` para
-- ordenar e o painel precisa saber quando o status mudou pela última vez.
CREATE OR REPLACE FUNCTION faltas_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_faltas_updated_at ON faltas;
CREATE TRIGGER trg_faltas_updated_at
  BEFORE UPDATE ON faltas
  FOR EACH ROW EXECUTE FUNCTION faltas_touch_updated_at();

-- ── Conferência ──────────────────────────────────────────────
-- Depois de rodar, isto deve devolver 11 linhas, todas tipo = 'falta'.
--
--   SELECT tipo, status, count(*) FROM faltas GROUP BY 1, 2;
