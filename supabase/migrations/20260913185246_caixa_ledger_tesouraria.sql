-- FASE 1 — LEDGER DE CAIXA, SÓ TESOURARIA (Caixa da Empresa).
--
-- Auditoria de 06/09/2026 (docs/auditoria/FASE-0-CONTROLE-DE-CAIXA.md): não
-- existe controle de caixa no sistema. `vendas`, `contas_receber` e
-- `contas_pagar` são DOCUMENTO comercial — nenhuma tabela do banco guarda um
-- movimento de dinheiro, e nenhuma guarda saldo.
--
-- PRINCÍPIO (seção N do documento): separar documento de movimento, e nunca
-- gravar saldo em coluna. `caixa_movimento` é o ledger, append-only. Saldo é
-- sempre a soma dos movimentos — calculado em `src/lib/caixa/movimento.ts`
-- (`calcularSaldo`), nunca uma coluna aqui. O sistema já tem um caso
-- documentado de saldo-em-coluna divergindo do real
-- (`produto_estoque` × `produtos.estoque`); não repetir o erro no financeiro.
--
-- ESCOPO DESTA MIGRATION — só o que a seção O do documento chama de Fase 1:
--   Caixa da Empresa (tesouraria). SEM sessão de PDV (Fase 3), sem sangria/
--   suprimento (Fase 2, que é transferência PDV↔tesouraria e por isso
--   depende de um caixa tipo=pdv existir). `caixa_sessao` NÃO nasce aqui:
--   criá-la vazia, sem nenhuma tela de PDV para preenchê-la, seria construir
--   à frente da necessidade — exatamente o que a seção K pede para evitar.
--
-- `natureza` fica restrita a quatro valores que fazem sentido sem PDV e sem
-- vínculo com contas_pagar/contas_receber (Fases 4 e 5, que ainda não
-- existem): aporte, retirada de sócio, depósito no banco, ajuste de
-- contagem. Sangria/suprimento/pagamento_conta/recebimento/venda entram por
-- ALTER TABLE quando as fases que os produzem existirem — estender um CHECK
-- depois é barato; ter uma coluna aceitando um valor que nada grava ainda
-- não é.
--
-- RLS DESDE O NASCIMENTO (mesmo padrão de `pdv_terminais`, 0.6A): `anon` não
-- recebe grant nenhum — este ledger nasce depois da Fase 0.5 e não tem
-- nenhum motivo para o terminal externo tocá-lo. Todo movimento nasce numa
-- rota de servidor autenticada (`exigirPermissao`), nunca do navegador.
--
-- APPEND-ONLY (seção K.5): UPDATE e DELETE de `caixa_movimento` são
-- revogados de `authenticated`. Corrigir um lançamento errado é lançar o
-- estorno — um movimento novo de sinal contrário, referenciando o original
-- por `estorno_de_id`. O índice único abaixo garante, no banco, que cada
-- movimento só é estornado uma vez.

CREATE TABLE IF NOT EXISTS caixa (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('pdv','tesouraria','banco')),
  nome         TEXT NOT NULL,

  -- Só existe para tipo='pdv' (turno de balcão) — não usado na Fase 1, mas a
  -- coluna já nasce com a trava certa para quando a Fase 3 precisar dela.
  terminal_id  UUID REFERENCES pdv_terminais(id) ON DELETE SET NULL,

  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT caixa_terminal_so_no_pdv CHECK (tipo = 'pdv' OR terminal_id IS NULL)
);

COMMENT ON TABLE caixa IS
  'Quem guarda dinheiro: PDV/balcão, tesouraria da empresa ou banco (futuro). '
  'Nunca guarda saldo — soma-se caixa_movimento.';

-- Uma tesouraria por empresa. Duas linhas 'tesouraria' para a mesma empresa
-- criariam a pergunta "o saldo da empresa é a soma de qual delas?", que é
-- exatamente a ambiguidade que este modelo existe para evitar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_tesouraria_unica
  ON caixa (empresa_id) WHERE tipo = 'tesouraria';

CREATE INDEX IF NOT EXISTS idx_caixa_empresa ON caixa (empresa_id);

CREATE TABLE IF NOT EXISTS caixa_movimento (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id              UUID NOT NULL REFERENCES caixa(id) ON DELETE RESTRICT,
  -- Redundante com caixa.empresa_id de propósito: RLS e os índices de
  -- listagem não podem depender de um JOIN em caixa para saber de quem é a
  -- linha. O trigger abaixo é o que impede a redundância de divergir.
  empresa_id            UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,

  tipo                  TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  natureza              TEXT NOT NULL CHECK (natureza IN ('aporte','retirada_socio','deposito_banco','ajuste')),
  -- Sempre positivo — o sinal do movimento está em `tipo`, nunca no valor.
  valor                 NUMERIC NOT NULL CHECK (valor > 0),
  forma_pagamento       TEXT CHECK (forma_pagamento IN ('dinheiro','pix','transferencia')),

  -- Referência polimórfica ao documento de origem (venda, conta_pagar,
  -- conta_receber…). Nula na Fase 1: aporte/retirada/depósito/ajuste não têm
  -- documento — nascem direto no caixa.
  referencia_tipo       TEXT,
  referencia_id         UUID,
  -- O outro lado de uma transferência (sangria/suprimento, Fase 2). Não
  -- usado na Fase 1 — não há um segundo caixa na empresa ainda.
  contraparte_caixa_id  UUID REFERENCES caixa(id) ON DELETE SET NULL,
  -- Correção é sempre um movimento novo de sinal contrário. NUNCA UPDATE/
  -- DELETE no original — ver REVOKE abaixo.
  estorno_de_id         UUID REFERENCES caixa_movimento(id) ON DELETE RESTRICT,

  observacao            TEXT,
  usuario_id            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE caixa_movimento IS
  'O ledger — append-only. Saldo de um caixa = soma de entrada − soma de '
  'saida dos seus movimentos, sempre calculado, nunca lido de uma coluna.';

CREATE INDEX IF NOT EXISTS idx_caixa_movimento_caixa
  ON caixa_movimento (caixa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caixa_movimento_empresa
  ON caixa_movimento (empresa_id, created_at DESC);

-- Cada movimento só pode ser estornado uma vez. Sem isto, duplo-clique numa
-- rota de estorno poderia lançar dois estornos para o mesmo lançamento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_caixa_movimento_estorno_unico
  ON caixa_movimento (estorno_de_id) WHERE estorno_de_id IS NOT NULL;

-- ── Trigger: empresa_id do movimento tem que ser a empresa do caixa ────────
CREATE OR REPLACE FUNCTION caixa_movimento_valida_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM caixa WHERE id = NEW.caixa_id AND empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'empresa_id do movimento (%) não bate com a empresa do caixa %', NEW.empresa_id, NEW.caixa_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_caixa_movimento_valida_empresa
  BEFORE INSERT ON caixa_movimento
  FOR EACH ROW EXECUTE FUNCTION caixa_movimento_valida_empresa();

-- `set_updated_at()` já existe no banco (usada por outras tabelas) — reaproveitada, não recriada.
CREATE TRIGGER trg_caixa_set_updated_at
  BEFORE UPDATE ON caixa
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS — mesmo padrão de pdv_terminais (0.6A) ──────────────────────────────
ALTER TABLE caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_movimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY caixa_do_grupo ON caixa
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

CREATE POLICY caixa_movimento_do_grupo ON caixa_movimento
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- `anon` não encosta — nem leitura. Diferente de vendas/produtos, este
-- ledger não tem nenhum consumidor externo (PDV não fala com ele ainda).
REVOKE ALL ON TABLE caixa, caixa_movimento FROM anon;

-- `caixa` é cadastro: pode renomear/desativar, mas não apagar (apagar
-- órfãos os movimentos que apontam pra ele — por isso a FK é RESTRICT).
REVOKE DELETE, TRUNCATE ON TABLE caixa FROM authenticated;

-- `caixa_movimento` é o ledger: nem UPDATE nem DELETE. Correção é estorno.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE caixa_movimento FROM authenticated;
