-- ============================================================
-- ENDEREÇAMENTO DE ESTOQUE — FASE 1 (FUNDAÇÃO)
--
-- Hoje o estoque tem dois níveis: produtos.estoque (total, autoritativo) e
-- produto_estoque (por depósito, espelho mantido pela aplicação). Não existe
-- nenhuma noção de ONDE dentro do depósito o produto está — só um campo
-- produto_estoque.localizacao em texto livre, sem estrutura.
--
-- Este arquivo acrescenta um terceiro nível, SEMPRE como subdivisão do que
-- já existe, nunca como um estoque paralelo:
--
--   EMPRESA → DEPÓSITO → ENDEREÇO → PRODUTO → QUANTIDADE
--
-- produto_estoque.quantidade continua sendo o número autoritativo por
-- depósito. A soma de produto_enderecos é um SUBCONJUNTO validado em
-- código (nunca pode superar o saldo do depósito) — nunca exigido a bater
-- exatamente, porque "estoque não endereçado" é um estado permitido durante
-- a adoção gradual. Nenhuma tabela existente é alterada em comportamento;
-- nenhum trigger é criado; nenhum fluxo de venda/entrada/transferência
-- muda. Tudo aqui é aditivo e fica invisível até um gestor ligar o módulo
-- explicitamente pra um depósito (ver deposito_enderecamento_config.modo).
--
-- RLS desligado em todas as tabelas novas — mesmo padrão de produto_estoque,
-- depositos, estoque_movimentacoes e transferencias_estoque, que são
-- referenciadas diretamente por FK daqui. Segurança fica nas rotas de API
-- (src/app/api/enderecamento/...), reconferindo empresa_id a cada request,
-- igual à Transferência de Estoque já em produção.
-- ============================================================


-- ── 1. Tipos de endereço — catálogo extensível por empresa ─────
--
-- TEXT livre em enderecos.tipo, validado em código contra esta tabela — não
-- é ENUM de banco de propósito, pra não exigir migração toda vez que um
-- gestor quiser um tipo novo. Mesma escolha já feita em
-- estoque_movimentacoes.tipo.

CREATE TABLE IF NOT EXISTS endereco_tipos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  codigo      TEXT NOT NULL,
  nome        TEXT NOT NULL,
  cor         TEXT,
  sistema     BOOLEAN NOT NULL DEFAULT false,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  ordem       INT DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(empresa_id, codigo)
);
ALTER TABLE endereco_tipos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_endereco_tipos_empresa ON endereco_tipos(empresa_id);

-- Semeia os 9 tipos padrão do pedido original para cada empresa já existente.
INSERT INTO endereco_tipos (empresa_id, codigo, nome, cor, sistema, ordem)
SELECT e.id, t.codigo, t.nome, t.cor, true, t.ordem
FROM empresas e
CROSS JOIN (VALUES
  ('RECEBIMENTO',  'Recebimento',  '#0ea5e9', 1),
  ('ARMAZENAGEM',  'Armazenagem',  '#22c55e', 2),
  ('PICKING',      'Picking',      '#eab308', 3),
  ('RESERVA',      'Reserva',      '#8b5cf6', 4),
  ('EXPEDICAO',    'Expedição',    '#f97316', 5),
  ('DEVOLUCAO',    'Devolução',    '#ec4899', 6),
  ('AVARIA',       'Avaria',       '#ef4444', 7),
  ('QUARENTENA',   'Quarentena',   '#64748b', 8),
  ('TRANSFERENCIA','Transferência','#06b6d4', 9)
) AS t(codigo, nome, cor, ordem)
ON CONFLICT (empresa_id, codigo) DO NOTHING;


-- ── 2. Config de endereçamento por depósito ─────────────────────
--
-- Tabela companheira separada de `depositos` (mesmo raciocínio de
-- empresa_config_estoque existir separada de empresas) — hierarquia e modo
-- de rollout são config do MÓDULO, não do depósito em si, e evoluem em
-- ritmo diferente. Ausência de linha = "endereçamento nunca configurado
-- pra este depósito", tratado como 'desativado' pela aplicação.

CREATE TABLE IF NOT EXISTS deposito_enderecamento_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  deposito_id       UUID NOT NULL UNIQUE REFERENCES depositos(id) ON DELETE CASCADE,
  niveis            JSONB NOT NULL DEFAULT '["zona","corredor","estante","nivel","posicao"]'::jsonb,
  separador         TEXT NOT NULL DEFAULT '-',
  padding_por_nivel JSONB NOT NULL DEFAULT '{}'::jsonb,
  modo              TEXT NOT NULL DEFAULT 'desativado'
                       CHECK (modo IN ('desativado', 'opcional', 'obrigatorio')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE deposito_enderecamento_config DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_dep_end_config_empresa ON deposito_enderecamento_config(empresa_id);

-- Semeia 'desativado' pra todo depósito ativo existente — assim a ausência
-- de config nunca é ambígua na aplicação.
INSERT INTO deposito_enderecamento_config (empresa_id, deposito_id, modo)
SELECT d.empresa_id, d.id, 'desativado'
FROM depositos d
WHERE d.ativo = true
ON CONFLICT (deposito_id) DO NOTHING;


-- ── 3. Endereços — a localização física ─────────────────────────

CREATE TABLE IF NOT EXISTS enderecos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  deposito_id           UUID NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,

  codigo_interno        TEXT NOT NULL,
  codigo_legivel        TEXT NOT NULL,
  descricao             TEXT,

  zona                  TEXT,
  corredor              TEXT,
  estante               TEXT,
  modulo                TEXT,
  nivel                 TEXT,
  posicao               TEXT,

  tipo                  TEXT NOT NULL DEFAULT 'ARMAZENAGEM',
  status                TEXT NOT NULL DEFAULT 'ativo'
                           CHECK (status IN ('ativo', 'inativo', 'bloqueado', 'temp_bloqueado',
                                              'em_inventario', 'cheio', 'reservado')),

  exclusivo             BOOLEAN NOT NULL DEFAULT false,
  produto_exclusivo_id  UUID REFERENCES produtos(id),

  -- Placeholders pra fases futuras — existem agora pra Fase 3 (picking) não
  -- exigir migração depois. Não são aplicados/validados em Fase 1.
  capacidade_maxima     NUMERIC(12,3),
  sequencia_picking     INT,

  qr_code_valor         TEXT,
  codigo_barras_valor   TEXT,

  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_por            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(empresa_id, deposito_id, codigo_interno)
);
ALTER TABLE enderecos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_enderecos_empresa_deposito ON enderecos(empresa_id, deposito_id);
CREATE INDEX IF NOT EXISTS idx_enderecos_deposito_status  ON enderecos(deposito_id, status);
CREATE INDEX IF NOT EXISTS idx_enderecos_tipo             ON enderecos(empresa_id, tipo);


-- ── 4. Produto × Depósito × Endereço × Quantidade ───────────────
--
-- O núcleo do módulo. NUNCA associar endereço direto no cadastro do
-- produto — um produto pode estar em vários endereços ao mesmo tempo, e
-- quantidades diferentes em cada um.

CREATE TABLE IF NOT EXISTS produto_enderecos (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  UUID NOT NULL,
  deposito_id                 UUID NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,
  endereco_id                 UUID NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  produto_id                  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,

  quantidade                  NUMERIC(12,3) NOT NULL DEFAULT 0,

  -- Placeholders pra fases futuras (reserva, separação, recebimento) —
  -- colunas existem já pra Fase 4/5 não exigirem migração. Fase 1 nunca
  -- escreve nelas.
  quantidade_reservada        NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantidade_em_separacao     NUMERIC(12,3) NOT NULL DEFAULT 0,
  quantidade_em_recebimento   NUMERIC(12,3) NOT NULL DEFAULT 0,

  papel                       TEXT CHECK (papel IN ('picking', 'reserva')),

  ultima_movimentacao         TIMESTAMPTZ DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(empresa_id, endereco_id, produto_id)
);
ALTER TABLE produto_enderecos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_prod_end_empresa           ON produto_enderecos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_prod_end_deposito          ON produto_enderecos(deposito_id);
CREATE INDEX IF NOT EXISTS idx_prod_end_produto           ON produto_enderecos(produto_id);
CREATE INDEX IF NOT EXISTS idx_prod_end_endereco          ON produto_enderecos(endereco_id);
CREATE INDEX IF NOT EXISTS idx_prod_end_deposito_produto  ON produto_enderecos(deposito_id, produto_id);

-- No máximo 1 endereço "picking" e 1 "reserva" por produto/depósito —
-- garantido no banco, sem trigger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prod_end_papel_unico
  ON produto_enderecos(deposito_id, produto_id, papel) WHERE papel IS NOT NULL;


-- ── 5. Histórico de movimentação entre endereços ────────────────
--
-- Tabela própria, NÃO reaproveita estoque_movimentacoes: uma transferência
-- endereço→endereço não muda o saldo do depósito (estoque_movimentacoes
-- registra deltas DO DEPÓSITO) — misturar contaminaria qualquer relatório
-- que soma movimentação por depósito com linhas que não representam
-- entrada/saída real de mercadoria no depósito.

CREATE TABLE IF NOT EXISTS endereco_movimentacoes (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  UUID NOT NULL,
  deposito_id                 UUID NOT NULL,
  endereco_origem_id          UUID REFERENCES enderecos(id),
  endereco_destino_id         UUID REFERENCES enderecos(id),
  produto_id                  UUID NOT NULL REFERENCES produtos(id),
  produto_nome                TEXT,
  tipo                        TEXT NOT NULL,  -- transferencia | ajuste_entrada | ajuste_saida | contagem
  quantidade                  NUMERIC(12,3) NOT NULL,
  quantidade_anterior_origem  NUMERIC(12,3),
  quantidade_nova_origem      NUMERIC(12,3),
  quantidade_anterior_destino NUMERIC(12,3),
  quantidade_nova_destino     NUMERIC(12,3),
  motivo                      TEXT,
  referencia_tipo             TEXT,
  referencia_id                UUID,
  usuario                     TEXT,
  observacao                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE endereco_movimentacoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_end_mov_empresa_created ON endereco_movimentacoes(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_end_mov_origem          ON endereco_movimentacoes(endereco_origem_id);
CREATE INDEX IF NOT EXISTS idx_end_mov_destino         ON endereco_movimentacoes(endereco_destino_id);
CREATE INDEX IF NOT EXISTS idx_end_mov_produto         ON endereco_movimentacoes(produto_id);


-- ── 6. Índices que faltavam em estoque_movimentacoes ────────────
--
-- Hoje só tem índice em empresa_id e produto_id. O dashboard e o histórico
-- por depósito deste módulo (e qualquer relatório por tipo/período) fariam
-- full scan sem isso.

CREATE INDEX IF NOT EXISTS idx_mov_tipo            ON estoque_movimentacoes(tipo);
CREATE INDEX IF NOT EXISTS idx_mov_deposito         ON estoque_movimentacoes(deposito_id);
CREATE INDEX IF NOT EXISTS idx_mov_empresa_created  ON estoque_movimentacoes(empresa_id, created_at DESC);


-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FROM endereco_tipos;
--   SELECT count(*) FROM deposito_enderecamento_config;
--   SELECT modo, count(*) FROM deposito_enderecamento_config GROUP BY modo;
