-- Loja Online: a categoria do produto na vitrine acompanha o cadastro (ERP).
--
-- Problema: `loja_produtos_indexar()` só preenchia `loja_categoria_id` quando
-- ele estava NULL. Trocar a categoria/subcategoria no cadastro e clicar em
-- "atualizar" não mudava nada — o produto ficava na categoria antiga, e essa
-- categoria continuava no menu enquanto tivesse ao menos um produto publicado.
--
-- Correção: guardamos a "assinatura" da categoria/subcategoria do cadastro que
-- gerou o posicionamento atual (`categoria_origem`). Quando a assinatura muda,
-- o produto é reposicionado pelo mapa `loja_categoria_origens`. Se a
-- assinatura não mudou, nada é mexido — posicionamentos ajustados à mão
-- (ex.: produto de "MATERIAL HIDRÁULICO / RALOS E GRELHAS" em "Ralos E
-- Grelhas") continuam como estão.
--
-- Categorias sem produto publicado já ficam escondidas do menu por
-- `loja_categorias_com_produtos()`; basta o produto sair da antiga.
--
-- Idempotente.

ALTER TABLE loja_produtos ADD COLUMN IF NOT EXISTS categoria_origem TEXT;

CREATE OR REPLACE FUNCTION loja_produtos_indexar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_nome TEXT; v_marca TEXT; v_cat TEXT; v_sub TEXT; v_assinatura TEXT;
  v_destino UUID;
BEGIN
  SELECT nome, sku, ean, marca, categoria, subcategoria, preco_venda, foto_url,
         preco_promocional, promocao_ativa, promocao_inicio, promocao_fim
    INTO p FROM produtos WHERE id = NEW.produto_id;

  IF p IS NULL THEN RETURN NEW; END IF;

  v_nome  := COALESCE(NULLIF(btrim(NEW.nome_comercial), ''), p.nome);
  v_marca := COALESCE(p.marca, '');
  v_cat   := COALESCE(p.categoria, '');
  v_sub   := COALESCE(p.subcategoria, '');

  NEW.busca :=
      setweight(to_tsvector('public.pt_unaccent', v_nome), 'A')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(p.sku, '')), 'A')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(p.ean, '')), 'A')
   || setweight(to_tsvector('public.pt_unaccent', v_marca), 'B')
   || setweight(to_tsvector('public.pt_unaccent', array_to_string(NEW.palavras_chave, ' ')), 'B')
   || setweight(to_tsvector('public.pt_unaccent', v_cat || ' ' || v_sub), 'C')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(NEW.descricao_curta, '')), 'C')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(NEW.descricao_completa, '')), 'D');

  NEW.busca_texto := lower(extensions.unaccent(
    v_nome || ' ' || v_marca || ' ' || v_cat || ' ' || v_sub || ' ' ||
    COALESCE(p.sku, '') || ' ' || COALESCE(p.ean, '')
  ));

  NEW.marca_vitrine := NULLIF(v_marca, '');
  NEW.preco_vitrine := CASE
    WHEN NEW.preco_loja IS NOT NULL THEN NEW.preco_loja
    WHEN COALESCE(p.promocao_ativa, false) AND COALESCE(p.preco_promocional, 0) > 0
         AND (p.promocao_inicio IS NULL OR p.promocao_inicio <= now())
         AND (p.promocao_fim    IS NULL OR p.promocao_fim    >= now())
      THEN p.preco_promocional
    ELSE p.preco_venda
  END;

  -- Ordem: escolha da loja > galeria da loja > galeria do cadastro > atalho foto_url.
  NEW.imagem_vitrine := COALESCE(
    NULLIF(btrim(COALESCE(NEW.imagem_principal_url, '')), ''),
    (SELECT li.url FROM loja_produto_imagens li
      WHERE li.loja_produto_id = NEW.id ORDER BY li.principal DESC, li.ordem LIMIT 1),
    (SELECT pi.url FROM produto_imagens pi
      WHERE pi.produto_id = NEW.produto_id
      ORDER BY pi.principal DESC, pi.ordem, pi.created_at LIMIT 1),
    NULLIF(btrim(COALESCE(p.foto_url, '')), '')
  );

  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := loja_slugify(v_nome || '-' || COALESCE(p.sku, left(NEW.produto_id::text, 8)));
  END IF;

  -- Categoria: reposiciona quando o cadastro mudou (ou nunca foi posicionado).
  v_assinatura := lower(extensions.unaccent(v_cat)) || '|' || lower(extensions.unaccent(v_sub));

  IF NEW.loja_categoria_id IS NULL OR NEW.categoria_origem IS DISTINCT FROM v_assinatura THEN
    SELECT o.loja_categoria_id INTO v_destino
      FROM loja_categoria_origens o
     WHERE o.loja_id = NEW.loja_id
       AND ((o.origem_campo = 'subcategoria' AND o.origem_chave = lower(extensions.unaccent(v_sub)) AND v_sub <> '')
         OR (o.origem_campo = 'categoria'    AND o.origem_chave = lower(extensions.unaccent(v_cat)) AND v_cat <> ''))
     ORDER BY (o.origem_campo = 'subcategoria') DESC
     LIMIT 1;

    -- Sem mapa para a categoria nova: sai da antiga em vez de ficar nela. Fica
    -- "sem categoria" (continua na busca) até alguém mapear a categoria.
    NEW.loja_categoria_id := v_destino;
    NEW.categoria_origem  := v_assinatura;
  END IF;

  RETURN NEW;
END;
$function$;

-- Linha de base: registra a assinatura atual sem reposicionar ninguém. O
-- trigger vê assinatura igual à calculada e deixa a categoria como está.
UPDATE loja_produtos lp
   SET categoria_origem = lower(extensions.unaccent(COALESCE(p.categoria, '')))
                          || '|' || lower(extensions.unaccent(COALESCE(p.subcategoria, '')))
  FROM produtos p
 WHERE p.id = lp.produto_id
   AND lp.categoria_origem IS NULL;

-- Correção pontual dos que já estavam desatualizados: só quando o destino
-- exato do cadastro é uma subcategoria da atual (refinamento) ou de outra
-- árvore (caso do TE ROSCÁVEL em "Elétrica"). Quem está numa categoria MAIS
-- ESPECÍFICA que a do cadastro (ex.: "Ralos E Grelhas") fica como está.
WITH RECURSIVE anc AS (
  SELECT id, id AS no, pai_id FROM loja_categorias
  UNION ALL
  SELECT a.id, c.id, c.pai_id FROM anc a JOIN loja_categorias c ON c.id = a.pai_id
), alvo AS (
  SELECT lp.id AS lp_id, lp.loja_categoria_id AS atual,
    (SELECT o.loja_categoria_id FROM loja_categoria_origens o
      WHERE o.loja_id = lp.loja_id
        AND ((o.origem_campo = 'subcategoria' AND o.origem_chave = lower(extensions.unaccent(COALESCE(p.subcategoria, ''))) AND COALESCE(p.subcategoria, '') <> '')
          OR (o.origem_campo = 'categoria'    AND o.origem_chave = lower(extensions.unaccent(COALESCE(p.categoria, '')))    AND COALESCE(p.categoria, '') <> ''))
      ORDER BY (o.origem_campo = 'subcategoria') DESC LIMIT 1) AS esperado
  FROM loja_produtos lp JOIN produtos p ON p.id = lp.produto_id
)
UPDATE loja_produtos lp
   SET loja_categoria_id = alvo.esperado
  FROM alvo
 WHERE lp.id = alvo.lp_id
   AND alvo.esperado IS NOT NULL
   AND alvo.atual IS DISTINCT FROM alvo.esperado
   AND NOT EXISTS (SELECT 1 FROM anc WHERE anc.id = alvo.atual AND anc.no = alvo.esperado);

NOTIFY pgrst, 'reload schema';
