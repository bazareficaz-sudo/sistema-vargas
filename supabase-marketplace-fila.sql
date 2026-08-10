-- ============================================================
-- FASE 3 — fila de atualização de anúncios (sistema → marketplace)
--
-- NASCE EM MODO SIMULAÇÃO. A fila enche, calcula tudo e grava o que ENVIARIA,
-- sem enviar nada para marketplace nenhum. Sair da simulação é um clique na
-- tela — mas só depois de alguns dias comparando a simulação com o que está
-- de fato nos canais. Um erro aqui não é um número errado numa tela: é um
-- anúncio com estoque errado vendendo o que não existe.
--
-- ── Por que gatilho no banco e não código de tela ───────────
--
-- O PDV externo grava direto no Supabase com a chave anônima e nunca executa
-- uma linha do código do site. Regra que mora na tela não alcança quem entra
-- por outra porta — foi exatamente assim que 87 vendas de carteira ficaram
-- sem conta a receber. O gatilho alcança todos os caminhos: PDV web, PDV
-- externo, entrada manual, entrada por XML, inventário, devolução, pedido de
-- marketplace, importação, correção manual no banco.
--
-- ── Por que conjunto e não histórico ────────────────────────
--
-- Um produto que se moveu 40 vezes em 5 minutos precisa de UM envio, não 40.
-- Por isso é uma linha por produto (UNIQUE empresa+produto) com a data em que
-- ficou sujo, e não uma fila de eventos.
--
-- ── Sobre o laço de realimentação ───────────────────────────
--
-- A Fase 1 importa dos canais e escreve SÓ em marketplace_anuncios — nunca em
-- produtos nem em produto_estoque. Por isso importar não suja a fila, e não
-- existe o ciclo "importa → suja → envia → importa". Se algum dia a
-- importação passar a escrever em produtos, este comentário deixa de ser
-- verdade e o ciclo nasce junto. Não faça isso sem tratar aqui.
-- ============================================================


-- ── 1. Configuração por empresa ─────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_fila_config (
  empresa_id           UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ativo                BOOLEAN NOT NULL DEFAULT false,
  -- Simulação ligada por padrão. Trocar isto é a decisão mais séria desta
  -- funcionalidade inteira; o padrão tem que ser o lado seguro.
  simulacao            BOOLEAN NOT NULL DEFAULT true,
  intervalo_min        INTEGER NOT NULL DEFAULT 15,
  max_produtos_rodada  INTEGER NOT NULL DEFAULT 100,
  -- Estoque neste nível ou abaixo fura a fila: o risco de vender o que não
  -- existe não pode esperar o intervalo normal.
  estoque_urgente      INTEGER NOT NULL DEFAULT 3,
  ultima_execucao      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_fila_config DISABLE ROW LEVEL SECURITY;


-- ── 2. A fila ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_fila (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_id  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  sujo_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo      TEXT,
  prioridade  SMALLINT NOT NULL DEFAULT 0,
  enviado_em  TIMESTAMPTZ,
  tentativas  INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  UNIQUE (empresa_id, produto_id)
);

-- Pendente = sujou depois do último envio. Sujar de novo enquanto pendente só
-- atualiza a data — continua sendo um envio só.
CREATE INDEX IF NOT EXISTS idx_fila_pendentes
  ON marketplace_fila (empresa_id, prioridade DESC, sujo_em)
  WHERE enviado_em IS NULL OR sujo_em > enviado_em;

ALTER TABLE marketplace_fila DISABLE ROW LEVEL SECURITY;


-- ── 3. Registro da simulação ────────────────────────────────
-- O que a fila TERIA enviado. É este histórico que permite comparar com o que
-- está de fato nos canais antes de confiar nela.

CREATE TABLE IF NOT EXISTS marketplace_fila_simulacao (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  rodada_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  canal_id         UUID REFERENCES marketplace_canais(id) ON DELETE CASCADE,
  anuncio_id       UUID REFERENCES marketplace_anuncios(id) ON DELETE CASCADE,
  produto_id       UUID REFERENCES produtos(id) ON DELETE CASCADE,
  acao             TEXT NOT NULL,
  estoque_sistema  NUMERIC,
  estoque_canal    NUMERIC,
  estoque_enviaria NUMERIC,
  preco_canal      NUMERIC,
  preco_enviaria   NUMERIC,
  detalhe          TEXT
);

CREATE INDEX IF NOT EXISTS idx_fila_simulacao_rodada
  ON marketplace_fila_simulacao (empresa_id, rodada_em DESC);

ALTER TABLE marketplace_fila_simulacao DISABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN marketplace_fila_simulacao.acao IS
  'enviaria | sem_mudanca | sem_anuncio | sem_mapeamento | com_variacao | erro';


-- ── 4. A função que enfileira ───────────────────────────────

CREATE OR REPLACE FUNCTION enfileirar_produto(
  p_empresa UUID, p_produto UUID, p_motivo TEXT, p_prioridade SMALLINT DEFAULT 0
) RETURNS void AS $$
BEGIN
  IF p_empresa IS NULL OR p_produto IS NULL THEN RETURN; END IF;

  INSERT INTO marketplace_fila (empresa_id, produto_id, sujo_em, motivo, prioridade)
  VALUES (p_empresa, p_produto, now(), p_motivo, p_prioridade)
  ON CONFLICT (empresa_id, produto_id) DO UPDATE SET
    sujo_em = now(),
    motivo  = EXCLUDED.motivo,
    -- Prioridade só sobe: se o produto já estava marcado como urgente, uma
    -- movimentação comum depois não pode rebaixá-lo.
    prioridade = GREATEST(marketplace_fila.prioridade, EXCLUDED.prioridade);
END;
$$ LANGUAGE plpgsql;


-- ── 5. Gatilho principal: mudança de estoque do produto ─────

CREATE OR REPLACE FUNCTION trg_fila_produto() RETURNS trigger AS $$
DECLARE
  v_urgente INTEGER;
  v_prio SMALLINT := 0;
  v_motivo TEXT;
BEGIN
  IF NEW.estoque IS NOT DISTINCT FROM OLD.estoque
     AND NEW.preco_venda IS NOT DISTINCT FROM OLD.preco_venda THEN
    RETURN NEW;
  END IF;

  v_motivo := CASE
    WHEN NEW.estoque IS DISTINCT FROM OLD.estoque
     AND NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN 'estoque e preço'
    WHEN NEW.estoque IS DISTINCT FROM OLD.estoque THEN 'estoque'
    ELSE 'preço'
  END;

  SELECT estoque_urgente INTO v_urgente
  FROM marketplace_fila_config WHERE empresa_id = NEW.empresa_id;

  IF NEW.estoque IS DISTINCT FROM OLD.estoque
     AND COALESCE(NEW.estoque, 0) <= COALESCE(v_urgente, 3) THEN
    v_prio := 1;
  END IF;

  PERFORM enfileirar_produto(NEW.empresa_id, NEW.id, v_motivo, v_prio);

  -- Kit muda quando o componente muda. O estoque do kit é derivado, então
  -- mexer no componente sem reenfileirar o kit deixaria o kit anunciado com
  -- um número que não é mais verdade.
  IF NEW.estoque IS DISTINCT FROM OLD.estoque THEN
    PERFORM enfileirar_produto(k.empresa_id, k.id, 'componente: ' || v_motivo, v_prio)
    FROM kit_itens ki
    JOIN produtos k ON k.id = ki.kit_id
    WHERE ki.produto_id = NEW.id
      AND COALESCE(ki.controla_estoque, true);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fila_produto ON produtos;
CREATE TRIGGER trg_fila_produto
  AFTER UPDATE ON produtos
  FOR EACH ROW EXECUTE FUNCTION trg_fila_produto();


-- ── 6. Gatilho do estoque por depósito ──────────────────────
-- Uma regra de anúncio pode contar o estoque de UM depósito. Nesse caso o
-- total do produto pode nem mudar (transferência entre depósitos) e ainda
-- assim o número que vai para o canal muda.

CREATE OR REPLACE FUNCTION trg_fila_produto_estoque() RETURNS trigger AS $$
DECLARE
  v_empresa UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade THEN
    RETURN NEW;
  END IF;

  SELECT empresa_id INTO v_empresa FROM produtos WHERE id = NEW.produto_id;
  PERFORM enfileirar_produto(v_empresa, NEW.produto_id, 'estoque do depósito', 0::SMALLINT);

  PERFORM enfileirar_produto(k.empresa_id, k.id, 'componente: estoque do depósito', 0::SMALLINT)
  FROM kit_itens ki
  JOIN produtos k ON k.id = ki.kit_id
  WHERE ki.produto_id = NEW.produto_id
    AND COALESCE(ki.controla_estoque, true);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fila_produto_estoque ON produto_estoque;
CREATE TRIGGER trg_fila_produto_estoque
  AFTER INSERT OR UPDATE ON produto_estoque
  FOR EACH ROW EXECUTE FUNCTION trg_fila_produto_estoque();


-- ── 7. Uma configuração por empresa que já tem canal ────────
-- Desligada e em simulação: existir a linha não liga nada.

INSERT INTO marketplace_fila_config (empresa_id)
SELECT DISTINCT empresa_id FROM marketplace_canais WHERE access_token IS NOT NULL
ON CONFLICT DO NOTHING;


-- ── 8. Conferência ──────────────────────────────────────────

SELECT 'config criada' AS o, count(*)::text AS v FROM marketplace_fila_config
UNION ALL
SELECT 'fila (deve estar vazia agora)', count(*)::text FROM marketplace_fila
UNION ALL
SELECT 'gatilhos ativos', count(*)::text FROM pg_trigger
  WHERE tgname IN ('trg_fila_produto', 'trg_fila_produto_estoque');
