-- A vitrine passa a ler a galeria do cadastro (`produto_imagens`) ANTES do
-- atalho `produtos.foto_url`.
--
-- O defeito, medido em 23/10/2026: a ordem de preferência da imagem era
--   escolha da loja > galeria da loja > produtos.foto_url > produto_imagens.
-- Só que as telas de edição de produto gravam APENAS em `produto_imagens` — o
-- `foto_url` nunca era atualizado (corrigido no código junto desta migração,
-- em src/lib/produtos/fotoPrincipal.ts). Então, quem trocava a foto no
-- cadastro continuava com a antiga na loja: 126 dos 646 publicados estavam
-- assim, 23 deles com a foto antiga já quebrada (link morto → vitrine sem
-- imagem). Caso que chegou como reclamação: produto 5091 — excluir a foto,
-- inserir outra, "atualizar", e a loja seguia sem imagem.
--
-- Agora: escolha da loja > galeria da loja > galeria do cadastro > foto_url.
-- `foto_url` fica como último recurso — produto antigo cuja única foto mora
-- nele (84 publicados têm foto_url e galeria vazia) continua com imagem.
--
-- Só a função muda; o gatilho e as colunas são os mesmos. O resto do corpo é
-- idêntico ao de supabase-loja-vitrine.sql (conferido contra a definição que
-- está no banco). Idempotente.

CREATE OR REPLACE FUNCTION loja_produtos_indexar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  v_nome TEXT; v_marca TEXT; v_cat TEXT; v_sub TEXT;
BEGIN
  SELECT nome, sku, ean, marca, categoria, subcategoria, preco_venda, foto_url,
         preco_promocional, promocao_ativa, promocao_inicio, promocao_fim
    INTO p FROM produtos WHERE id = NEW.produto_id;

  IF p IS NULL THEN RETURN NEW; END IF;

  v_nome  := COALESCE(NULLIF(btrim(NEW.nome_comercial), ''), p.nome);
  v_marca := COALESCE(p.marca, '');
  v_cat   := COALESCE(p.categoria, '');
  v_sub   := COALESCE(p.subcategoria, '');

  -- Pesos: A o que identifica (nome, código, código de barras), B a marca e
  -- as palavras-chave que o operador escolheu, C a classificação e o resumo,
  -- D o texto longo. Sem pesos, uma palavra perdida na descrição valeria o
  -- mesmo que o nome do produto.
  NEW.busca :=
      setweight(to_tsvector('public.pt_unaccent', v_nome), 'A')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(p.sku, '')), 'A')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(p.ean, '')), 'A')
   || setweight(to_tsvector('public.pt_unaccent', v_marca), 'B')
   || setweight(to_tsvector('public.pt_unaccent', array_to_string(NEW.palavras_chave, ' ')), 'B')
   || setweight(to_tsvector('public.pt_unaccent', v_cat || ' ' || v_sub), 'C')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(NEW.descricao_curta, '')), 'C')
   || setweight(to_tsvector('public.pt_unaccent', COALESCE(NEW.descricao_completa, '')), 'D');

  -- Alvo do trigram. Curto de propósito: incluir a descrição inteira faria a
  -- similaridade por palavra casar com qualquer coisa.
  NEW.busca_texto := lower(extensions.unaccent(
    v_nome || ' ' || v_marca || ' ' || v_cat || ' ' || v_sub || ' ' ||
    COALESCE(p.sku, '') || ' ' || COALESCE(p.ean, '')
  ));

  -- Espelhos para a listagem ordenar e filtrar sem tocar em `produtos`.
  NEW.marca_vitrine := NULLIF(v_marca, '');
  NEW.preco_vitrine := CASE
    WHEN NEW.preco_loja IS NOT NULL THEN NEW.preco_loja
    WHEN COALESCE(p.promocao_ativa, false) AND COALESCE(p.preco_promocional, 0) > 0
         AND (p.promocao_inicio IS NULL OR p.promocao_inicio <= now())
         AND (p.promocao_fim    IS NULL OR p.promocao_fim    >= now())
      THEN p.preco_promocional
    ELSE p.preco_venda
  END;

  -- Imagem principal resolvida uma vez. Ordem de preferência: escolha da
  -- loja > galeria da loja > galeria do cadastro > atalho `foto_url`. NULL é
  -- resultado legítimo e esperado — a publicação não exige foto, e a vitrine
  -- tem um estado próprio para isso.
  NEW.imagem_vitrine := COALESCE(
    NULLIF(btrim(COALESCE(NEW.imagem_principal_url, '')), ''),
    (SELECT li.url FROM loja_produto_imagens li
      WHERE li.loja_produto_id = NEW.id ORDER BY li.principal DESC, li.ordem LIMIT 1),
    (SELECT pi.url FROM produto_imagens pi
      WHERE pi.produto_id = NEW.produto_id
      ORDER BY pi.principal DESC, pi.ordem, pi.created_at LIMIT 1),
    NULLIF(btrim(COALESCE(p.foto_url, '')), '')
  );

  -- Slug: gerado uma vez, na criação. Nunca regerado sozinho — slug que muda
  -- quebra link já compartilhado e derruba a posição no Google.
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := loja_slugify(v_nome || '-' || COALESCE(p.sku, left(NEW.produto_id::text, 8)));
  END IF;

  -- Categoria comercial: respeita a escolha manual; só resolve pelo
  -- mapeamento quando ninguém escolheu.
  IF NEW.loja_categoria_id IS NULL THEN
    SELECT o.loja_categoria_id INTO NEW.loja_categoria_id
      FROM loja_categoria_origens o
     WHERE o.loja_id = NEW.loja_id
       AND ((o.origem_campo = 'subcategoria' AND o.origem_chave = lower(extensions.unaccent(v_sub)) AND v_sub <> '')
         OR (o.origem_campo = 'categoria'    AND o.origem_chave = lower(extensions.unaccent(v_cat)) AND v_cat <> ''))
     ORDER BY (o.origem_campo = 'subcategoria') DESC   -- o mais específico ganha
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;


-- Reindexa as lojas para a regra nova valer agora, e não só no próximo reindex
-- de cada produto. É a mesma operação do botão "Reclassificar produtos".
DO $$
DECLARE l RECORD;
BEGIN
  FOR l IN SELECT id FROM loja_config LOOP
    PERFORM loja_reindexar(l.id);
  END LOOP;
END $$;


-- Como conferir depois de rodar (deve dar 0):
--
--   with principal as (
--     select distinct on (produto_id) produto_id, url
--     from produto_imagens order by produto_id, principal desc, ordem, created_at)
--   select count(*) from loja_produtos lp
--     join principal pr on pr.produto_id = lp.produto_id
--    where lp.status = 'publicado' and lp.imagem_principal_url is null
--      and not exists (select 1 from loja_produto_imagens li where li.loja_produto_id = lp.id)
--      and lp.imagem_vitrine <> pr.url;
