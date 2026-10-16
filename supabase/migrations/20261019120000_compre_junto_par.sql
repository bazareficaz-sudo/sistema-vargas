-- COMPRE JUNTO: indicação manual e "ocultar" passam a valer para o PAR.
--
-- O histórico de vendas já era simétrico (o par visto dos dois lados), mas o
-- ajuste manual gravado no cadastro valia num sentido só: indicar a fita
-- isolante no cadastro do disjuntor fazia o PDV oferecer a fita quando o
-- disjuntor estava no carrinho — e não o contrário. Quem indica um par espera
-- os dois associados.
--
-- A regra fica na função (e não em duas linhas gravadas) para valer também
-- para as indicações que já existiam, e para não haver dois registros do
-- mesmo par que possam discordar. A tela do cadastro passa a apagar o par nos
-- dois sentidos ao remover uma indicação.

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
  -- Indicação manual vale para o PAR, nos dois sentidos: indicar a fita no
  -- disjuntor faz o disjuntor aparecer quando a fita está no carrinho.
  fixados_par AS (
    SELECT a.sugerido_id, a.produto_id AS base_id
    FROM produto_compre_junto_ajuste a
    WHERE a.acao = 'fixar' AND a.produto_id IN (SELECT id FROM base)
    UNION
    SELECT a.produto_id, a.sugerido_id
    FROM produto_compre_junto_ajuste a
    WHERE a.acao = 'fixar' AND a.sugerido_id IN (SELECT id FROM base)
  ),
  fixados AS (
    SELECT f.sugerido_id, f.base_id,
           coalesce(p.vezes, 0) AS vezes, true AS fixo
    FROM fixados_par f
    LEFT JOIN pares p ON p.base_id = f.base_id AND p.sugerido_id = f.sugerido_id
  ),
  candidatos AS (
    SELECT c.*,
      EXISTS (
        SELECT 1 FROM produto_compre_junto_ajuste o
        WHERE o.acao = 'ocultar'
          AND ((o.produto_id = c.base_id AND o.sugerido_id = c.sugerido_id)
            OR (o.produto_id = c.sugerido_id AND o.sugerido_id = c.base_id))
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
