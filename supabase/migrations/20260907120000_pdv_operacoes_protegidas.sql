-- FASE 0.6B — a primeira operação atrás da identidade do terminal.
--
-- Duas coisas, e nenhuma delas toca no caminho de venda:
--
--   1. um interruptor por terminal, para o rollout ser um terminal de cada vez
--   2. um registro do que passou pela rota protegida, que serve de auditoria
--      E de trava de idempotência ao mesmo tempo
--
-- Por que a mesma tabela para as duas coisas: a pergunta "esta requisição já
-- foi executada?" e a pergunta "o que este terminal fez?" têm exatamente a
-- mesma chave. Separar em duas tabelas criaria a possibilidade de elas
-- discordarem.

ALTER TABLE pdv_terminais
  ADD COLUMN IF NOT EXISTS usar_rotas_novas BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN pdv_terminais.usar_rotas_novas IS
  'Feature flag por terminal. Falso = usa o caminho legado. Ligar/desligar não '
  'exige deploy nem migration — é o que permite migrar um terminal de cada vez.';

CREATE TABLE IF NOT EXISTS pdv_operacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id      UUID NOT NULL REFERENCES pdv_terminais(id) ON DELETE CASCADE,
  empresa_id       UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

  operacao         TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,

  -- SÓ 'terminal_token' é aceito, e isso é deliberado.
  --
  -- A tentação seria ter também 'legacy_anon' aqui para contar a migração.
  -- Seria uma mentira estrutural: o caminho legado escreve direto no
  -- PostgREST e nunca passa por esta tabela, então a coluna registraria zero
  -- legado para sempre — exatamente o defeito que o painel da 0.6A tinha. O
  -- lado legado é contado onde ele de fato aparece: nos edge logs, por
  -- request.sb.jwt.authorization.payload.role = 'anon'.
  metodo           TEXT NOT NULL DEFAULT 'terminal_token'
    CHECK (metodo IN ('terminal_token')),

  status           TEXT NOT NULL DEFAULT 'em_andamento'
    CHECK (status IN ('em_andamento','sucesso','erro')),

  -- A resposta devolvida na primeira execução. É ela que o retry recebe de
  -- volta, para que repetir a chamada seja indistinguível de tê-la feito uma
  -- vez só — inclusive no corpo da resposta.
  resposta         JSONB,
  erro             TEXT,
  versao_pdv       TEXT,

  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em     TIMESTAMPTZ
);

-- A trava. Vem do banco e não do código: duas requisições simultâneas com a
-- mesma chave disputam este índice, e o Postgres decide — uma insere, a outra
-- leva conflito e lê o resultado da primeira.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_operacoes_idem
  ON pdv_operacoes (terminal_id, operacao, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_pdv_operacoes_empresa
  ON pdv_operacoes (empresa_id, criado_em DESC);

ALTER TABLE pdv_operacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdv_operacoes_do_grupo ON pdv_operacoes
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

REVOKE ALL ON TABLE pdv_operacoes FROM anon;
REVOKE DELETE, TRUNCATE ON TABLE pdv_operacoes FROM authenticated;

-- Enquanto estamos aqui: `anon` ainda podia TRUNCATE em pdv_impressao. A onda
-- anterior de fechamento tirou INSERT/UPDATE/DELETE e esqueceu TRUNCATE, que
-- apaga a tabela inteira sem passar por DELETE.
REVOKE TRUNCATE ON TABLE pdv_impressao FROM anon;