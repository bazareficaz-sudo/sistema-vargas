-- ============================================================
-- Estoque unificado entre empresas do mesmo grupo
--
-- Quando duas empresas do grupo vendem o mesmo item e a mercadoria está
-- fisicamente junta (ou é atendida indistintamente), o estoque que vale para
-- os anúncios é a SOMA — não o número isolado de cada CNPJ.
--
-- O que decide "qual produto da empresa B é o mesmo da empresa A" já existe:
-- `produto_vinculos`, criado na fase de Parcerias. Aqui só se escolhe QUAIS
-- empresas entram na soma e, de cada uma, QUAL depósito é contabilizado.
--
-- Limite de segurança: só empresas do mesmo `tenant_id`, igual às Parcerias.
-- Nunca atravessa clientes diferentes da plataforma.
-- ============================================================

-- Liga a unificação para a empresa dona da configuração. Desligado por
-- padrão: nenhuma empresa passa a somar estoque de outra por causa desta
-- migração.
ALTER TABLE empresa_config_estoque
  ADD COLUMN IF NOT EXISTS estoque_unificado_ativo BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS estoque_unificado_participantes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Empresa DONA da configuração: é o estoque dela que passa a enxergar a soma.
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Empresa do grupo que entra na conta.
  participante_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Depósito da participante que é contabilizado.
  -- NULL = todos os depósitos dela (o estoque total do produto).
  deposito_id     UUID REFERENCES depositos(id) ON DELETE SET NULL,
  criado_por      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Uma linha por participante: dois depósitos da mesma empresa somando
  -- viraria dupla contagem silenciosa.
  UNIQUE (empresa_id, participante_id)
);

ALTER TABLE estoque_unificado_participantes DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_estoque_unif_empresa
  ON estoque_unificado_participantes(empresa_id);

-- A própria empresa dona também escolhe de qual depósito conta o SEU estoque.
-- NULL = total do produto, que é o comportamento de hoje.
ALTER TABLE empresa_config_estoque
  ADD COLUMN IF NOT EXISTS estoque_unificado_deposito_id UUID REFERENCES depositos(id) ON DELETE SET NULL;
