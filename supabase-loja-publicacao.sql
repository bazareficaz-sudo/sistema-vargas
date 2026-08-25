-- ============================================================
-- LOJA ONLINE — Fase 1: publicação e categorias comerciais
--
-- Duas operações que a tela do painel precisa fazer em MASSA. Publicar 500
-- produtos com uma requisição por produto seriam 500 idas ao banco — é assim
-- que uma tela de catálogo fica impraticável no primeiro uso real.
--
-- Depende de supabase-loja-fundacao.sql, -estoque.sql e -vitrine.sql.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Semear a árvore comercial a partir do catálogo
--
-- O ERP guarda categoria como TEXTO, e o texto está duplicado: medido nesta
-- base, 54 grafias distintas para 48 categorias reais —
-- "PRODUTOS QUIMICOS", "Produtos Quimicos" e "Produtos Químicos" são a
-- mesma coisa escrita de três jeitos.
--
-- Esta função agrupa pelo texto NORMALIZADO (minúsculo, sem acento), o que
-- funde as grafias sozinha. A vitrine fica limpa sem UM ÚNICO UPDATE em
-- `produtos` — que é o que torna a faxina de categorias segura: ela acontece
-- na camada comercial, e o cadastro do ERP continua exatamente como está.
--
-- O que ela deliberadamente NÃO faz: adivinhar que "Hidráulica" e
-- "MATERIAL HIDRÁULICO" são a mesma coisa. São palavras diferentes; fundir
-- isso é decisão de quem conhece a loja. Palpite silencioso aqui seria pior
-- que o problema — o painel permite juntar depois.
--
-- Nome de exibição em initcap: vitrine com título em CAIXA ALTA parece
-- cadastro de ERP, que é exatamente a percepção que este projeto quer evitar.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_semear_categorias(p_loja_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_n       INTEGER := 0;
  r         RECORD;
  v_cat_id  UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM loja_config WHERE id = p_loja_id;
  IF v_empresa IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT lower(extensions.unaccent(btrim(p.categoria))) AS chave,
           -- Entre as grafias do mesmo grupo, a mais frequente vira o rótulo.
           mode() WITHIN GROUP (ORDER BY btrim(p.categoria)) AS rotulo,
           count(*) AS qtd
      FROM produtos p
     WHERE p.empresa_id = v_empresa AND p.ativo
       AND COALESCE(btrim(p.categoria), '') <> ''
     GROUP BY 1
     ORDER BY count(*) DESC
  LOOP
    SELECT id INTO v_cat_id FROM loja_categorias
     WHERE loja_id = p_loja_id AND slug = loja_slugify(r.rotulo);

    IF v_cat_id IS NULL THEN
      INSERT INTO loja_categorias (empresa_id, loja_id, nome, slug, ordem)
      VALUES (v_empresa, p_loja_id, initcap(r.rotulo), loja_slugify(r.rotulo), v_n)
      RETURNING id INTO v_cat_id;
      v_n := v_n + 1;
    END IF;

    -- Idempotente: rodar de novo depois de o catálogo crescer só acrescenta
    -- o que falta, sem mexer no que o operador já renomeou ou aninhou.
    INSERT INTO loja_categoria_origens (empresa_id, loja_id, loja_categoria_id,
                                        origem_chave, origem_rotulo, origem_campo)
    VALUES (v_empresa, p_loja_id, v_cat_id, r.chave, r.rotulo, 'categoria')
    ON CONFLICT (loja_id, origem_campo, origem_chave) DO NOTHING;
  END LOOP;

  RETURN v_n;
END;
$$;


-- ============================================================
-- 2. Publicação em massa
--
-- Nunca exige foto, descrição, marca ou ficha técnica. A decisão de publicar
-- é do usuário (decisão de 24/08/2026): o sistema MEDE a qualidade do
-- catálogo e mostra o que falta, mas não bloqueia. Um produto sem foto vai
-- para a vitrine com o placeholder do design system.
--
-- A trava que existe é outra, e essa não é negociável: só entra produto da
-- empresa DONA da loja. Sem a linha `p.empresa_id = v_empresa`, um id de
-- outra empresa passado na requisição publicaria produto alheio na vitrine.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_publicar_produtos(
  p_loja_id     UUID,
  p_produto_ids UUID[],
  p_status      TEXT DEFAULT 'publicado',
  p_usuario     UUID DEFAULT NULL
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_empresa UUID; v_n INTEGER;
BEGIN
  IF p_status NOT IN ('nao_publicado', 'rascunho', 'publicado', 'pausado') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  SELECT empresa_id INTO v_empresa FROM loja_config WHERE id = p_loja_id;
  IF v_empresa IS NULL OR p_produto_ids IS NULL OR array_length(p_produto_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO loja_produtos (empresa_id, loja_id, produto_id, status, slug, publicado_em, publicado_por)
  SELECT v_empresa, p_loja_id, p.id, p_status, '',
         CASE WHEN p_status = 'publicado' THEN now() END, p_usuario
    FROM produtos p
   WHERE p.id = ANY(p_produto_ids) AND p.empresa_id = v_empresa AND p.ativo
  ON CONFLICT (loja_id, produto_id) DO UPDATE
    SET status = EXCLUDED.status,
        -- Preserva a data da PRIMEIRA publicação: é ela que ordena
        -- "Novidades". Republicar não faz o produto virar novidade de novo.
        publicado_em = COALESCE(loja_produtos.publicado_em, EXCLUDED.publicado_em),
        updated_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- O slug, o índice de busca e a categoria comercial são resolvidos pelo
  -- gatilho trg_loja_produtos_indexar. O estoque não — é cache, e precisa ser
  -- calculado aqui, senão o produto nasce na vitrine como indisponível.
  PERFORM loja_atualizar_estoque_cache(p_loja_id, p_produto_ids);
  RETURN v_n;
END;
$$;


-- ============================================================
-- 3. Atualização sob demanda de um produto já publicado
--
-- Diferente de `loja_reindexar_pendentes()`, que o cron chama e que só toca
-- no que mudou: aqui é o operador dizendo "atualiza ESTE agora", direto da
-- listagem de Produtos do ERP. Força, sem perguntar se mudou — porque quem
-- clica acabou de mexer no cadastro e não quer esperar os 15 minutos do cron
-- só para conferir se a foto entrou.
--
-- Faz as duas coisas que o cron faz, para o produto ficar coerente de uma vez.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_sincronizar_produtos(p_loja_id UUID, p_produto_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  IF p_produto_ids IS NULL OR array_length(p_produto_ids, 1) IS NULL THEN RETURN 0; END IF;

  -- Tocar em updated_at faz o gatilho recalcular imagem, busca, marca e
  -- categoria a partir do cadastro.
  UPDATE loja_produtos
     SET updated_at = now()
   WHERE loja_id = p_loja_id AND produto_id = ANY(p_produto_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM loja_atualizar_estoque_cache(p_loja_id, p_produto_ids);
  RETURN v_n;
END;
$$;


-- ============================================================
-- 4. Privilégios — nada para o anônimo
-- ============================================================

REVOKE ALL ON FUNCTION loja_semear_categorias(UUID)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_publicar_produtos(UUID, UUID[], TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_sincronizar_produtos(UUID, UUID[])          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION loja_semear_categorias(UUID)                     TO authenticated;
GRANT EXECUTE ON FUNCTION loja_publicar_produtos(UUID, UUID[], TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION loja_sincronizar_produtos(UUID, UUID[])          TO authenticated;


-- ============================================================
-- CONFERÊNCIA
--
--   -- quantas grafias do ERP caíram em quantas categorias:
--   SELECT count(DISTINCT btrim(categoria))                        AS grafias,
--          count(DISTINCT lower(extensions.unaccent(btrim(categoria)))) AS categorias
--     FROM produtos WHERE empresa_id = '<empresa>' AND ativo AND categoria <> '';
--
--   -- estado do catálogo depois de publicar:
--   SELECT * FROM loja_saude_catalogo('<loja_id>');
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   DROP FUNCTION IF EXISTS loja_publicar_produtos(UUID, UUID[], TEXT, UUID);
--   DROP FUNCTION IF EXISTS loja_semear_categorias(UUID);
-- ============================================================
