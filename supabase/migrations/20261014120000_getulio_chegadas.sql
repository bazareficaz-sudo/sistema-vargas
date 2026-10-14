-- GETÚLIO — BOLETIM "CHEGOU NA LOJA".
--
-- Mercadoria nova ou reposta entra pela nota e nem todo vendedor fica
-- sabendo. A cada nota lançada (entrada manual ou XML), o Getúlio monta um
-- boletim com o que chegou e manda no GRUPO de WhatsApp dos vendedores; o
-- PDV mostra "Chegou hoje" com a mesma lista.
--
-- getulio_chegadas_config — uma linha por empresa (liga/desliga, grupo).
-- getulio_chegadas        — um boletim por nota. A UNIQUE é o que impede o
--                           mesmo boletim de sair duas vezes: a tela que
--                           finaliza a nota e o cron (rede de segurança)
--                           podem chegar juntos, e só um consegue gravar.

CREATE TABLE IF NOT EXISTS getulio_chegadas_config (
  empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT false,
  -- ID do grupo na Z-API ("120363...-group"). Sem grupo, o boletim só aparece no PDV.
  grupo_id TEXT,
  grupo_nome TEXT,
  -- Reposição comum (item que não estava em falta) entra no boletim.
  incluir_reposicao BOOLEAN NOT NULL DEFAULT true,
  -- Produto que chegou sem preço de venda vai para o dono, não para o grupo.
  avisar_sem_preco BOOLEAN NOT NULL DEFAULT true,
  -- Só nota lançada DEPOIS de ligar entra — ligar não dispara boletim antigo.
  ativado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS getulio_chegadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Mesmo par de estoque_movimentacoes: 'entrada' (manual) ou 'entrada_xml'.
  referencia_tipo TEXT NOT NULL,
  referencia_id UUID NOT NULL,
  rotulo TEXT,
  fornecedor TEXT,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  novidades INT NOT NULL DEFAULT 0,
  voltaram INT NOT NULL DEFAULT 0,
  repostos INT NOT NULL DEFAULT 0,
  sem_preco INT NOT NULL DEFAULT 0,
  -- 'enviando' → 'enviado' | 'erro' | 'sem_grupo' | 'sem_novidade'
  status TEXT NOT NULL DEFAULT 'enviando',
  texto TEXT,
  erro TEXT,
  tentativas INT NOT NULL DEFAULT 0,
  enviado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, referencia_tipo, referencia_id)
);

CREATE INDEX IF NOT EXISTS idx_getulio_chegadas_empresa_data ON getulio_chegadas (empresa_id, created_at DESC);

-- A rede de segurança do cron procura notas recentes ainda sem boletim.
CREATE INDEX IF NOT EXISTS idx_estoque_mov_entrada_recente
  ON estoque_movimentacoes (empresa_id, created_at)
  WHERE tipo IN ('entrada_compra', 'entrada_nfe');

ALTER TABLE getulio_chegadas_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE getulio_chegadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS getulio_chegadas_config_do_grupo ON getulio_chegadas_config;
CREATE POLICY getulio_chegadas_config_do_grupo ON getulio_chegadas_config
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS getulio_chegadas_do_grupo ON getulio_chegadas;
CREATE POLICY getulio_chegadas_do_grupo ON getulio_chegadas
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());
