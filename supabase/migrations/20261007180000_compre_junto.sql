-- COMPRE JUNTO: o que o cliente costuma levar junto com cada produto.
--
-- No balcão de material de construção a venda que agrega é a do item que o
-- cliente esqueceu: o parafuso sem a bucha, a areia sem o cimento, o joelho
-- soldável sem o adesivo. O histórico do PDV já sabe quais produtos saem
-- juntos — a medição de 07/10/2026 achou 1.270 pares que se repetiram em 2+
-- vendas (parafuso 4,8x40 + bucha 8 em 29 vendas, areia + cimento em 44).
--
-- ── POR QUE FUNÇÃO E NÃO TABELA CALCULADA ───────────────────────────────
--
-- As sugestões são calculadas na hora, direto de vendas/venda_itens. Com o
-- volume atual (~5 mil vendas) a consulta parte do índice de
-- venda_itens(produto_id) e custa milissegundos. Uma tabela pré-calculada
-- exigiria rotina de recálculo, e a venda de hoje só viraria sugestão
-- amanhã. Se o volume crescer a ponto de pesar, a assinatura da função fica
-- e só o corpo passa a ler de uma tabela.
--
-- Simétrico por construção: se o disjuntor saiu com a fita, a fita sugere o
-- disjuntor e o disjuntor sugere a fita — é o mesmo par visto dos dois lados.
--
-- ── O QUE O GESTOR CONTROLA ─────────────────────────────────────────────
--
-- produto_compre_junto_ajuste guarda as decisões manuais, no cadastro:
--   'fixar'   sugere sempre, mesmo sem histórico (produto novo, lançamento);
--   'ocultar' nunca sugere este par, mesmo com histórico (coincidência).
-- Ficam fora do cálculo automático, então não se perdem quando ele muda.

CREATE TABLE IF NOT EXISTS produto_compre_junto_ajuste (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_id   UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  sugerido_id  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  acao         TEXT NOT NULL CHECK (acao IN ('fixar', 'ocultar')),
  criado_por   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (produto_id, sugerido_id),
  CHECK (produto_id <> sugerido_id)
);

CREATE INDEX IF NOT EXISTS idx_compre_junto_ajuste_produto
  ON produto_compre_junto_ajuste (produto_id);

-- Mesmo padrão das tabelas de configuração da empresa: isolamento por
-- empresa_id na aplicação, e nada para o anônimo.
ALTER TABLE produto_compre_junto_ajuste DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON produto_compre_junto_ajuste FROM anon;


-- Item lançado a partir de uma sugestão do PDV. É o que permite medir se o
-- Compre Junto está agregando venda — sem isso a funcionalidade seria fé.
ALTER TABLE venda_itens ADD COLUMN IF NOT EXISTS origem_sugestao TEXT;

COMMENT ON COLUMN venda_itens.origem_sugestao IS
  'Preenchido quando o item entrou na venda por uma sugestão do PDV (ex.: compre_junto). Nulo = lançado pelo vendedor.';


-- Sugestões para um conjunto de produtos (o carrinho do PDV, ou um produto só
-- no cadastro).
--
-- venda_itens.venda_id e .produto_id são TEXT neste banco. O cast para uuid
-- passa por uma checagem de formato: um valor torto numa linha antiga
-- derrubaria a consulta inteira — e, com ela, o painel do PDV.
CREATE OR REPLACE FUNCTION compre_junto_sugestoes(
  p_produto_ids       UUID[],
  p_limite            INT     DEFAULT 6,
  p_minimo            INT     DEFAULT 2,
  p_dias              INT     DEFAULT 365,
  p_incluir_ocultos   BOOLEAN DEFAULT false
)
RETURNS TABLE (produto_id UUID, base_id UUID, vezes INT, fixo BOOLEAN, oculto BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT DISTINCT unnest(p_produto_ids) AS id
  ),
  -- Vendas concluídas da janela que levaram algum produto da base.
  vendas_base AS (
    SELECT DISTINCT vi.venda_id, vi.produto_id::uuid AS base_id
    FROM venda_itens vi
    JOIN vendas v
      ON v.id = CASE WHEN vi.venda_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN vi.venda_id::uuid END
    WHERE vi.produto_id IN (SELECT id::text FROM base)
      AND coalesce(vi.tipo, 'venda') = 'venda'
      AND v.status = 'concluida'
      AND v.created_at >= now() - make_interval(days => p_dias)
  ),
  -- O que mais saiu nessas vendas, par a par com o produto da base.
  pares AS (
    SELECT
      CASE WHEN vi.produto_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN vi.produto_id::uuid END AS sugerido_id,
      vb.base_id,
      count(DISTINCT vi.venda_id)::int AS vezes
    FROM vendas_base vb
    JOIN venda_itens vi ON vi.venda_id = vb.venda_id
    WHERE coalesce(vi.tipo, 'venda') = 'venda'
      AND vi.produto_id IS NOT NULL
    GROUP BY 1, 2
  ),
  automaticos AS (
    SELECT p.sugerido_id, p.base_id, p.vezes, false AS fixo
    FROM pares p
    WHERE p.sugerido_id IS NOT NULL
      AND p.vezes >= p_minimo
  ),
  fixados AS (
    SELECT a.sugerido_id, a.produto_id AS base_id,
           coalesce(p.vezes, 0) AS vezes, true AS fixo
    FROM produto_compre_junto_ajuste a
    LEFT JOIN pares p ON p.base_id = a.produto_id AND p.sugerido_id = a.sugerido_id
    WHERE a.acao = 'fixar' AND a.produto_id IN (SELECT id FROM base)
  ),
  candidatos AS (
    SELECT c.*,
      EXISTS (
        SELECT 1 FROM produto_compre_junto_ajuste o
        WHERE o.acao = 'ocultar' AND o.produto_id = c.base_id AND o.sugerido_id = c.sugerido_id
      ) AS oculto
    FROM (SELECT * FROM automaticos UNION ALL SELECT * FROM fixados) c
    WHERE c.sugerido_id NOT IN (SELECT id FROM base)
  ),
  -- Um produto sugerido por mais de um item do carrinho aparece uma vez só,
  -- explicado pelo item com quem ele mais saiu junto.
  por_sugerido AS (
    SELECT DISTINCT ON (c.sugerido_id) c.sugerido_id, c.base_id, c.vezes, c.fixo, c.oculto
    FROM candidatos c
    WHERE p_incluir_ocultos OR NOT c.oculto
    ORDER BY c.sugerido_id, c.oculto, c.fixo DESC, c.vezes DESC
  )
  SELECT s.sugerido_id, s.base_id, s.vezes, s.fixo, s.oculto
  FROM por_sugerido s
  JOIN produtos ps ON ps.id = s.sugerido_id AND ps.ativo
  WHERE NOT EXISTS (
    -- Similar não é complemento: quem leva o disjuntor da Steck não precisa
    -- ouvir a oferta do mesmo disjuntor da WEG.
    SELECT 1 FROM produtos pb
    WHERE pb.id IN (SELECT id FROM base)
      AND pb.grupo_similar IS NOT NULL
      AND pb.grupo_similar = ps.grupo_similar
  )
  ORDER BY s.oculto, s.fixo DESC, s.vezes DESC
  LIMIT greatest(p_limite, 0);
$$;

REVOKE ALL ON FUNCTION compre_junto_sugestoes(UUID[], INT, INT, INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION compre_junto_sugestoes(UUID[], INT, INT, INT, BOOLEAN) TO authenticated, service_role;
