-- FASE 0.6A — IDENTIDADE DO TERMINAL PDV.
--
-- Hoje o terminal se identifica por `store.get('config.terminal_id')`, uma
-- string num JSON local que o operador edita, e a empresa vem do mesmo
-- arquivo. Estas duas tabelas trocam isso por: credencial emitida pelo
-- servidor → terminal identificado → empresa determinada pelo servidor.
--
-- NADA AQUI TOCA NO FLUXO LEGADO. São tabelas novas; o PDV que não ativar
-- continua vendendo exatamente como hoje.
--
-- RLS DESDE O NASCIMENTO, ao contrário das tabelas antigas: `anon` não
-- recebe grant nenhum, e as rotas de ativação/token usam a chave de serviço
-- (elas atendem um PDV que ainda não tem identidade — é o único jeito).

CREATE TABLE IF NOT EXISTS pdv_terminais (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome                    TEXT NOT NULL,

  -- HASH do segredo do terminal, nunca o segredo. SHA-256 basta e é o certo
  -- aqui: o segredo tem 256 bits de aleatoriedade, então não há espaço para
  -- força bruta. bcrypt existe para senha humana, que é curta e previsível —
  -- usá-lo num segredo aleatório só custaria CPU a cada renovação.
  secret_hash             TEXT,

  status                  TEXT NOT NULL DEFAULT 'aguardando_ativacao'
    CHECK (status IN ('aguardando_ativacao','ativo','revogado')),

  -- Telemetria. NÃO é identidade: o `terminal_id` legado continua vindo do
  -- arquivo local editável, e serve só para casar o novo terminal com as
  -- vendas antigas na hora de conferir o rollout.
  terminal_id_legado      TEXT,
  versao_pdv              TEXT,
  dispositivo             JSONB,
  metodo_ultima_auth      TEXT CHECK (metodo_ultima_auth IN ('terminal_token','legacy_anon')),

  ativado_em              TIMESTAMPTZ,
  ultima_autenticacao_em  TIMESTAMPTZ,
  ultima_atividade_em     TIMESTAMPTZ,

  revogado_em             TIMESTAMPTZ,
  revogado_por            UUID,
  motivo_revogacao        TEXT,

  created_by              UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_terminais_empresa ON pdv_terminais (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pdv_terminais_status  ON pdv_terminais (status);

-- Códigos de ativação. Credencial temporária: guardamos só o hash, e o
-- prefixo em claro apenas para a tela dizer "o código que começa com AB7F".
CREATE TABLE IF NOT EXISTS pdv_ativacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  terminal_id     UUID NOT NULL REFERENCES pdv_terminais(id) ON DELETE CASCADE,
  codigo_hash     TEXT NOT NULL,
  codigo_prefixo  TEXT NOT NULL,
  expira_em       TIMESTAMPTZ NOT NULL,
  usado_em        TIMESTAMPTZ,
  -- Guarda QUAL segredo resgatou este código. É o que torna a ativação
  -- idempotente: se a resposta se perder e o PDV repetir a chamada com o
  -- mesmo segredo, o servidor reconhece e devolve sucesso em vez de recusar
  -- um código já usado — sem isso, um pacote perdido deixaria o terminal
  -- travado esperando um código novo.
  usado_por_hash  TEXT,
  tentativas      INTEGER NOT NULL DEFAULT 0,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_ativacoes_terminal ON pdv_ativacoes (terminal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_ativacoes_codigo ON pdv_ativacoes (codigo_hash);

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE pdv_terminais ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdv_ativacoes ENABLE ROW LEVEL SECURITY;

-- O mesmo padrão das ~40 policies que já existem neste banco. Nada de
-- `using (true)`.
CREATE POLICY pdv_terminais_do_grupo ON pdv_terminais
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

CREATE POLICY pdv_ativacoes_do_grupo ON pdv_ativacoes
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- `anon` não encosta. As rotas de ativação e de token atendem um PDV sem
-- identidade e por isso rodam com a chave de serviço, no servidor.
REVOKE ALL ON TABLE pdv_terminais, pdv_ativacoes FROM anon;

-- Terminal não se apaga: revogar é mudar status, e o histórico é o que
-- permite responder "quem autorizou aquele terminal, e quando".
REVOKE DELETE, TRUNCATE ON TABLE pdv_terminais, pdv_ativacoes FROM authenticated;