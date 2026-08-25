-- ============================================================
-- LOJA ONLINE — Fase 1: busca, vitrine e cache de estoque
--
-- Três coisas que andam juntas:
--
--   1. BUSCA de verdade. Hoje o sistema não tem nenhuma: nem pg_trgm, nem
--      unaccent, nem tsvector, nem índice GIN além de `produtos.tags`. Toda
--      busca é `ilike` encadeado. Com 14 mil produtos por empresa isso não
--      para em pé numa vitrine pública.
--
--   2. VIEWS DE LISTA BRANCA. Custo, margem, fornecedor e dado fiscal não
--      podem sair — e a garantia disso tem que morar no banco, não na
--      disciplina de quem escreve o `select`. `produtos.estoque` também fica
--      de fora: disponibilidade só se responde por loja_estoque_disponivel().
--
--   3. CACHE DE ESTOQUE. Listagem e busca precisam FILTRAR e ORDENAR por
--      disponibilidade. Calcular ao vivo para todo o catálogo a cada busca é
--      o caminho conhecido para uma vitrine lenta. Então: a listagem usa um
--      cache de minutos; a página do produto, o carrinho e o checkout usam o
--      número ao vivo. É o desenho padrão de e-commerce — a lista pode estar
--      alguns minutos velha, o momento da verdade nunca está.
--
-- Depende de supabase-loja-fundacao.sql e supabase-loja-estoque.sql.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Extensões
--
-- No Supabase, extensão vive no schema `extensions` — é onde pgcrypto e
-- uuid-ossp já estão neste projeto. Instalar em `public` polui o schema que
-- o PostgREST expõe.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;


-- ============================================================
-- 2. Configuração de busca em português, sem acento
--
-- `to_tsvector('portuguese', ...)` já resolve plural e radical ("tubos" acha
-- "tubo"). O que falta é o acento: quem digita "hidraulica" no celular não
-- pode deixar de achar "hidráulica".
--
-- A solução certa não é chamar unaccent() na consulta — isso impede o uso de
-- índice. É uma CONFIGURAÇÃO de busca que já aplica o dicionário unaccent
-- antes do radical. Aí `to_tsvector('pt_unaccent', ...)` é IMMUTABLE e
-- indexável.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace
     WHERE c.cfgname = 'pt_unaccent' AND n.nspname = 'public'
  ) THEN
    CREATE TEXT SEARCH CONFIGURATION public.pt_unaccent (COPY = pg_catalog.portuguese);
  END IF;
END $$;

-- Ordem importa: unaccent primeiro (tira o acento), portuguese_stem depois
-- (reduz ao radical). Invertido, o radicalizador receberia a palavra
-- acentuada e devolveria outro radical.
ALTER TEXT SEARCH CONFIGURATION public.pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH extensions.unaccent, portuguese_stem;


-- ============================================================
-- 3. Colunas de apoio em loja_produtos
--
-- Todas na tabela nova — nenhum ALTER em tabela do ERP.
-- ============================================================

ALTER TABLE loja_produtos
  -- Categoria comercial resolvida. Materializada na publicação para a
  -- listagem não precisar resolver o mapeamento de texto a cada consulta.
  ADD COLUMN IF NOT EXISTS loja_categoria_id UUID REFERENCES loja_categorias(id) ON DELETE SET NULL,
  -- Cache de disponibilidade (ver cabeçalho, item 3).
  ADD COLUMN IF NOT EXISTS estoque_disponivel NUMERIC,
  ADD COLUMN IF NOT EXISTS estoque_publicavel NUMERIC,
  ADD COLUMN IF NOT EXISTS estoque_cache_em   TIMESTAMPTZ,
  -- Congelados na publicação, só para ordenar e filtrar a listagem sem join
  -- em `produtos`. A fonte da verdade continua sendo o cadastro.
  ADD COLUMN IF NOT EXISTS preco_vitrine NUMERIC,
  ADD COLUMN IF NOT EXISTS marca_vitrine TEXT,
  -- Espelho da imagem principal. Entrou por MEDIÇÃO, não por precaução: a
  -- busca levava 115 ms enquanto a condição pura do índice GIN levava 2,2 ms.
  -- A diferença estava na view, que resolvia a imagem com duas subconsultas
  -- correlacionadas para CADA linha candidata, antes do LIMIT. Com a coluna,
  -- caiu para 34 ms.
  ADD COLUMN IF NOT EXISTS imagem_vitrine TEXT;

CREATE INDEX IF NOT EXISTS idx_loja_produtos_categoria
  ON loja_produtos (loja_id, loja_categoria_id) WHERE status = 'publicado';
CREATE INDEX IF NOT EXISTS idx_loja_produtos_preco
  ON loja_produtos (loja_id, preco_vitrine) WHERE status = 'publicado';
CREATE INDEX IF NOT EXISTS idx_loja_produtos_disponivel
  ON loja_produtos (loja_id, estoque_publicavel) WHERE status = 'publicado';


-- ============================================================
-- 4. Índices de busca
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_loja_produtos_busca
  ON loja_produtos USING gin (busca);

-- Trigram para tolerar erro de digitação ("furaderia", "hidralica").
-- gin_trgm_ops atende o operador <% (word_similarity), que é o certo aqui:
-- compara as PALAVRAS da consulta curta contra um texto longo. O operador %
-- compararia as duas strings inteiras e nunca casaria.
CREATE INDEX IF NOT EXISTS idx_loja_produtos_busca_trgm
  ON loja_produtos USING gin (busca_texto extensions.gin_trgm_ops);


-- ============================================================
-- 5. Indexação — o gatilho
--
-- Roda em loja_produtos, e SÓ nela. Deliberadamente NÃO existe gatilho em
-- `produtos`: é a tabela mais quente do sistema (o PDV escreve nela em toda
-- venda) e pendurar trabalho ali para servir a vitrine seria cobrar do caixa
-- o custo da loja.
--
-- O preço de não ter gatilho lá: mudança no cadastro só chega à busca no
-- próximo reindex (publicação, botão do painel, ou cron noturno). Aceitável
-- — e explícito, em vez de mágico.
-- ============================================================

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
  -- loja > galeria da loja > cadastro. NULL é resultado legítimo e esperado —
  -- a publicação não exige foto, e a vitrine tem um estado próprio para isso
  -- (mais da metade do catálogo publicado cai nele hoje).
  NEW.imagem_vitrine := COALESCE(
    NULLIF(btrim(COALESCE(NEW.imagem_principal_url, '')), ''),
    (SELECT li.url FROM loja_produto_imagens li
      WHERE li.loja_produto_id = NEW.id ORDER BY li.principal DESC, li.ordem LIMIT 1),
    NULLIF(btrim(COALESCE(p.foto_url, '')), ''),
    (SELECT pi.url FROM produto_imagens pi
      WHERE pi.produto_id = NEW.produto_id ORDER BY pi.principal DESC, pi.ordem LIMIT 1)
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

DROP TRIGGER IF EXISTS trg_loja_produtos_indexar ON loja_produtos;
CREATE TRIGGER trg_loja_produtos_indexar
  BEFORE INSERT OR UPDATE ON loja_produtos
  FOR EACH ROW EXECUTE FUNCTION loja_produtos_indexar();


-- Reindexação em massa. `updated_at` muda, o gatilho recalcula tudo.
CREATE OR REPLACE FUNCTION loja_reindexar(p_loja_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE loja_produtos SET updated_at = now() WHERE loja_id = p_loja_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;


-- Reindexação INCREMENTAL — a que o cron chama.
--
-- Sem ela, `loja_produtos` guardava espelhos do cadastro que NUNCA se
-- atualizavam: o gatilho acima só dispara em INSERT/UPDATE da própria linha,
-- e `loja_reindexar` só era chamada pelos botões da aba Categorias. Produto
-- que ganhava foto no ERP não passava a mostrá-la na vitrine, e a busca
-- continuava indexada pelo nome antigo. Foi um buraco real da primeira
-- entrega, achado ao perguntarem justamente isso.
--
-- Só entra a linha cujo produto mudou: a cada 15 minutos, reprocessar o
-- catálogo publicado inteiro é desperdício que cresce com a loja.
--
-- `>=` e não `>`, e o motivo apareceu num teste: `now()` é o timestamp da
-- TRANSAÇÃO. Alteração e reindexação dentro da mesma transação carimbam o
-- mesmo instante, e a mudança ficaria para trás em silêncio. Não cria laço —
-- depois de reindexar, `lp.updated_at` é estritamente maior, porque as
-- transações são outras.
CREATE OR REPLACE FUNCTION loja_reindexar_pendentes(p_loja_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE loja_produtos lp
     SET updated_at = now()
    FROM produtos p
   WHERE p.id = lp.produto_id
     AND (p_loja_id IS NULL OR lp.loja_id = p_loja_id)
     AND (
       -- `produtos.updated_at` é mantido por trg_produtos_updated_at, e
       -- definir a foto principal grava `produtos.foto_url` — então o caso
       -- da foto cai aqui.
       p.updated_at >= lp.updated_at
       -- Rede de segurança: imagem que entrou só em produto_imagens.
       OR EXISTS (SELECT 1 FROM produto_imagens pi
                   WHERE pi.produto_id = lp.produto_id AND pi.created_at >= lp.updated_at)
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION loja_reindexar_pendentes(UUID) IS
  'Reindexa só as publicações cujo produto mudou desde a última indexação. Chamada pelo cron de manutenção.';


-- ============================================================
-- 6. Cache de estoque
--
-- Escreve em loja_produtos o resultado de loja_estoque_disponivel(). Chamada
-- ao publicar, pelo botão do painel e pelo cron.
-- `p_produto_ids` nulo = a loja inteira.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_atualizar_estoque_cache(p_loja_id UUID, p_produto_ids UUID[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids UUID[];
  v_n INTEGER;
BEGIN
  IF p_produto_ids IS NULL THEN
    SELECT array_agg(produto_id) INTO v_ids FROM loja_produtos WHERE loja_id = p_loja_id;
  ELSE
    v_ids := p_produto_ids;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN RETURN 0; END IF;

  UPDATE loja_produtos lp
     SET estoque_disponivel = e.disponivel,
         estoque_publicavel = e.publicavel,
         estoque_cache_em   = now()
    FROM loja_estoque_disponivel(p_loja_id, v_ids) e
   WHERE lp.loja_id = p_loja_id AND lp.produto_id = e.produto_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;


-- ============================================================
-- 7. View de vitrine — a lista branca
--
-- O que NÃO está aqui é tão importante quanto o que está:
--   preco_custo, markup, obs_interna, codigo_fornecedor, fornecedor_padrao_id,
--   estoque, estoque_minimo, ncm, cfop, cst, csosn, alíquotas, precos_quantidade.
--
-- Nenhum desses pode chegar a uma página pública, e a garantia é estrutural:
-- a camada de comércio consulta ESTA view, não `produtos`.
-- ============================================================

DROP VIEW IF EXISTS loja_vitrine_produtos;
CREATE VIEW loja_vitrine_produtos AS
SELECT
  lp.id                AS loja_produto_id,
  lp.loja_id,
  lp.produto_id,
  lp.slug,
  lp.status,
  lp.destaque,
  lp.ordem,
  lp.loja_categoria_id,
  lp.created_at,
  lp.publicado_em,

  COALESCE(NULLIF(btrim(lp.nome_comercial), ''), p.nome)              AS nome,
  NULLIF(btrim(COALESCE(lp.descricao_curta, '')), '')                 AS descricao_curta,
  COALESCE(NULLIF(btrim(COALESCE(lp.descricao_completa, '')), ''),
           NULLIF(btrim(COALESCE(p.descricao_marketplace, '')), ''))   AS descricao_completa,
  lp.caracteristicas,
  lp.especificacoes,
  lp.aplicacoes,
  p.marca,
  p.categoria      AS categoria_erp,
  p.subcategoria   AS subcategoria_erp,
  p.unidade,
  p.sku,
  p.ean,

  -- Dimensões: entram porque o frete da Fase 6 precisa delas e não há nada
  -- de sensível num peso. Custo não entra nunca.
  p.peso_kg, p.comprimento_cm, p.largura_cm, p.altura_cm,

  -- ── Preço ────────────────────────────────────────────────
  pr.preco,
  -- O "de" riscado só existe se for MAIOR que o preço efetivo. Riscado menor
  -- que o preço é o golpe de vitrine mais comum, e aqui é impossível.
  CASE WHEN pr.preco_de > pr.preco THEN pr.preco_de END                AS preco_de,
  lp.preco_pix,

  -- ── Imagem ───────────────────────────────────────────────
  -- Lê o espelho materializado na indexação (ver §5). `imagem_principal_url`
  -- mantém precedência para o caso de alguém editá-la sem reindexar.
  COALESCE(NULLIF(btrim(COALESCE(lp.imagem_principal_url, '')), ''),
           lp.imagem_vitrine)                                          AS imagem_url,

  -- ── Disponibilidade (cache; ver cabeçalho) ───────────────
  COALESCE(lp.estoque_publicavel, 0)                                   AS estoque_publicavel,
  lp.estoque_cache_em,
  lp.limite_maximo_por_compra,

  -- ── SEO ──────────────────────────────────────────────────
  COALESCE(NULLIF(btrim(COALESCE(lp.seo_title, '')), ''),
           COALESCE(NULLIF(btrim(lp.nome_comercial), ''), p.nome))     AS seo_title,
  lp.meta_description
FROM loja_produtos lp
JOIN produtos p ON p.id = lp.produto_id
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN lp.preco_loja IS NOT NULL THEN lp.preco_loja
      WHEN COALESCE(p.promocao_ativa, false) AND COALESCE(p.preco_promocional, 0) > 0
           AND (p.promocao_inicio IS NULL OR p.promocao_inicio <= now())
           AND (p.promocao_fim    IS NULL OR p.promocao_fim    >= now())
        THEN p.preco_promocional
      ELSE p.preco_venda
    END AS preco,
    COALESCE(
      lp.preco_de,
      CASE WHEN COALESCE(p.promocao_ativa, false) AND COALESCE(p.preco_promocional, 0) > 0
            AND (p.promocao_inicio IS NULL OR p.promocao_inicio <= now())
            AND (p.promocao_fim    IS NULL OR p.promocao_fim    >= now())
           THEN p.preco_venda END
    ) AS preco_de
) pr;

COMMENT ON VIEW loja_vitrine_produtos IS
  'Lista branca do que pode aparecer numa página pública. Custo, margem, fornecedor, fiscal e estoque bruto ficam de fora por construção.';


-- ============================================================
-- 8. Busca e listagem
--
-- Uma função para as duas coisas: a listagem de categoria é a busca sem
-- termo. Duas implementações divergiriam, como já aconteceu neste projeto
-- com o filtro de entrada de mercadoria.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_buscar(
  p_loja_id      UUID,
  p_termo        TEXT    DEFAULT NULL,
  p_categoria_id UUID    DEFAULT NULL,
  p_marca        TEXT    DEFAULT NULL,
  p_preco_min    NUMERIC DEFAULT NULL,
  p_preco_max    NUMERIC DEFAULT NULL,
  p_so_promocao  BOOLEAN DEFAULT false,
  p_so_disponivel BOOLEAN DEFAULT false,
  p_ordem        TEXT    DEFAULT 'relevancia',
  p_pagina       INTEGER DEFAULT 1,
  p_por_pagina   INTEGER DEFAULT 24
)
RETURNS TABLE (
  loja_produto_id UUID, produto_id UUID, slug TEXT, nome TEXT, marca TEXT,
  imagem_url TEXT, preco NUMERIC, preco_de NUMERIC, preco_pix NUMERIC,
  estoque_publicavel NUMERIC, destaque BOOLEAN, total BIGINT
)
-- `extensions` no search_path porque o operador <% do pg_trgm mora lá. Sem
-- isso: "operator does not exist: text <% text". Operador não aceita nome
-- qualificado inline sem a sintaxe OPERATOR(), então o caminho é o
-- search_path — que continua fixo e confiável.
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_q          TSQUERY;
  v_termo_norm TEXT;
  v_ocultar    BOOLEAN;
  v_offset     INTEGER;
  v_limite     INTEGER;
  v_tem_termo  BOOLEAN;
BEGIN
  -- Limiar de similaridade do trigram. MEDIDO nos nomes reais deste catálogo:
  -- erro de digitação legítimo cai entre 0,50 e 0,67 ("hidralica" 0,50,
  -- "torneria" 0,556, "furaderia" 0,60), e o ruído de verdade dá 0,0. O
  -- padrão do pg_trgm (0,6) descartaria metade dos acertos.
  --
  -- Feito com set_config e não com a cláusula SET da função porque o Supabase
  -- nega ALTER de parâmetro de extensão na definição ("permission denied to
  -- set parameter"). O terceiro argumento `true` é LOCAL: vale só dentro
  -- desta transação e não vaza para o resto da sessão.
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.45', true);

  -- Teto rígido de página: sem isso, `p_por_pagina=100000` numa URL pública
  -- é um jeito barato de derrubar o banco.
  v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 24), 1), 60);
  v_offset := GREATEST(COALESCE(p_pagina, 1) - 1, 0) * v_limite;

  SELECT (c.sem_estoque_comportamento = 'ocultar' AND NOT c.permitir_venda_sem_estoque)
    INTO v_ocultar FROM loja_config c WHERE c.id = p_loja_id;

  v_tem_termo := p_termo IS NOT NULL AND btrim(p_termo) <> '';
  IF v_tem_termo THEN
    -- websearch_to_tsquery trata espaço como E: "furadeira bosch" exige as
    -- duas. É o que o cliente espera, e o que evita a lista de 300 itens.
    v_q := websearch_to_tsquery('public.pt_unaccent', btrim(p_termo));
    v_termo_norm := lower(extensions.unaccent(btrim(p_termo)));
  END IF;

  RETURN QUERY
  WITH RECURSIVE arvore AS (
    SELECT lc.id FROM loja_categorias lc WHERE lc.id = p_categoria_id
    UNION ALL
    SELECT f.id FROM loja_categorias f JOIN arvore a ON f.pai_id = a.id
  ),
  base AS (
    SELECT v.*,
           -- Três faixas que NUNCA se misturam. `ts_rank` devolve 0 quando o
           -- casamento veio do trigrama, e não do tsquery — com todos em 0, o
           -- desempate caía no nome, em ordem alfabética. Medido: "lampada
           -- led" trazia "ABRACADEIRA PARA LAMPADA FERRO T10" antes de
           -- "LAMPADA LED BULBO 09W".
           CASE
             WHEN v_q IS NULL THEN 0
             -- Código de barras e SKU: quem digita 13 dígitos quer aquele item.
             WHEN v_termo_norm IN (lower(COALESCE(v.ean, '')), lower(COALESCE(v.sku, ''))) THEN 1000
             WHEN lp.busca @@ v_q THEN 10 + ts_rank(lp.busca, v_q)
             ELSE word_similarity(v_termo_norm, lp.busca_texto)
           END AS rank
      FROM loja_vitrine_produtos v
      JOIN loja_produtos lp ON lp.id = v.loja_produto_id
     WHERE v.loja_id = p_loja_id
       AND v.status  = 'publicado'
       AND (v_q IS NULL OR lp.busca @@ v_q OR v_termo_norm <% lp.busca_texto)
       AND (p_categoria_id IS NULL OR v.loja_categoria_id IN (SELECT id FROM arvore)
            OR EXISTS (SELECT 1 FROM loja_produto_categorias pc
                        WHERE pc.loja_produto_id = v.loja_produto_id
                          AND pc.loja_categoria_id IN (SELECT id FROM arvore)))
       AND (p_marca IS NULL OR v.marca = p_marca)
       AND (p_preco_min IS NULL OR v.preco >= p_preco_min)
       AND (p_preco_max IS NULL OR v.preco <= p_preco_max)
       AND (NOT p_so_promocao OR v.preco_de IS NOT NULL)
       AND (NOT p_so_disponivel OR v.estoque_publicavel > 0)
       -- Política da loja: quando é "ocultar", item sem saldo some da
       -- listagem e da busca. A PÁGINA dele continua existindo — quem tem o
       -- link ainda abre, e o Google não perde a URL.
       AND (NOT COALESCE(v_ocultar, false) OR v.estoque_publicavel > 0)
  ),
  contado AS (SELECT count(*) AS n FROM base)
  SELECT b.loja_produto_id, b.produto_id, b.slug, b.nome, b.marca, b.imagem_url,
         b.preco, b.preco_de, b.preco_pix, b.estoque_publicavel, b.destaque, c.n
    FROM base b CROSS JOIN contado c
   ORDER BY
     CASE WHEN p_ordem = 'menor_preco' THEN b.preco END ASC NULLS LAST,
     CASE WHEN p_ordem = 'maior_preco' THEN b.preco END DESC NULLS LAST,
     CASE WHEN p_ordem = 'novidades'   THEN b.publicado_em END DESC NULLS LAST,
     CASE WHEN p_ordem = 'nome'        THEN b.nome END ASC,
     -- NAVEGANDO (sem termo) a pergunta é "o que vocês têm?" → saldo primeiro.
     -- BUSCANDO a pergunta é "vocês têm ISTO?" → relevância primeiro, e o
     -- saldo só desempata. Esconder o item procurado porque acabou faz o
     -- cliente concluir que a loja não trabalha com aquilo, e ir embora.
     CASE WHEN p_ordem = 'relevancia' AND NOT v_tem_termo AND b.estoque_publicavel > 0 THEN 0
          WHEN p_ordem = 'relevancia' AND NOT v_tem_termo THEN 1 ELSE 0 END,
     CASE WHEN p_ordem = 'relevancia' THEN b.rank END DESC,
     CASE WHEN p_ordem = 'relevancia' AND b.estoque_publicavel > 0 THEN 0 ELSE 1 END,
     b.destaque DESC, b.ordem, b.nome
   OFFSET v_offset LIMIT v_limite;
END;
$$;


-- ============================================================
-- 9. Sugestões da barra de busca (autocomplete)
--
-- Separada da busca completa: o teclado do celular dispara muitas chamadas,
-- e cada uma precisa ser barata. Só nome, imagem e preço.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_sugerir(p_loja_id UUID, p_termo TEXT, p_limite INTEGER DEFAULT 6)
RETURNS TABLE (slug TEXT, nome TEXT, imagem_url TEXT, preco NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_q TSQUERY; v_norm TEXT;
BEGIN
  IF p_termo IS NULL OR length(btrim(p_termo)) < 2 THEN RETURN; END IF;
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.45', true);
  v_q    := websearch_to_tsquery('public.pt_unaccent', btrim(p_termo));
  v_norm := lower(extensions.unaccent(btrim(p_termo)));

  RETURN QUERY
    SELECT v.slug, v.nome, v.imagem_url, v.preco
      FROM loja_vitrine_produtos v
      JOIN loja_produtos lp ON lp.id = v.loja_produto_id
     WHERE v.loja_id = p_loja_id AND v.status = 'publicado'
       AND (lp.busca @@ v_q OR v_norm <% lp.busca_texto)
     ORDER BY (v.estoque_publicavel > 0) DESC,
              CASE WHEN lp.busca @@ v_q THEN 10 + ts_rank(lp.busca, v_q)
                   ELSE word_similarity(v_norm, lp.busca_texto) END DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limite, 6), 1), 10);
END;
$$;


-- ============================================================
-- 10. Saúde do catálogo
--
-- O diagnóstico desta fase foi que o gargalo do projeto é a qualidade do
-- dado, não o código. Esta função é o número dessa frase, e alimenta a
-- Visão Geral do painel.
--
-- Conta, nunca corrige e nunca bloqueia: a decisão de publicar é do usuário.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_saude_catalogo(p_loja_id UUID)
RETURNS TABLE (
  publicados BIGINT, rascunhos BIGINT, pausados BIGINT,
  sem_foto BIGINT, sem_descricao BIGINT, sem_preco BIGINT,
  sem_estoque BIGINT, sem_marca BIGINT, sem_categoria BIGINT,
  prontos BIGINT, catalogo_ativo BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_empresa UUID;
BEGIN
  SELECT c.empresa_id INTO v_empresa FROM loja_config c WHERE c.id = p_loja_id;
  IF v_empresa IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE v.status = 'publicado'),
    count(*) FILTER (WHERE v.status = 'rascunho'),
    count(*) FILTER (WHERE v.status = 'pausado'),
    count(*) FILTER (WHERE v.status = 'publicado' AND v.imagem_url IS NULL),
    count(*) FILTER (WHERE v.status = 'publicado' AND v.descricao_completa IS NULL AND v.descricao_curta IS NULL),
    count(*) FILTER (WHERE v.status = 'publicado' AND COALESCE(v.preco, 0) <= 0),
    count(*) FILTER (WHERE v.status = 'publicado' AND COALESCE(v.estoque_publicavel, 0) <= 0),
    count(*) FILTER (WHERE v.status = 'publicado' AND v.marca IS NULL),
    count(*) FILTER (WHERE v.status = 'publicado' AND v.loja_categoria_id IS NULL),
    -- "Pronto" = tem foto, tem preço e tem saldo. É o número que responde
    -- "quantos produtos a loja realmente vende hoje".
    count(*) FILTER (WHERE v.status = 'publicado' AND v.imagem_url IS NOT NULL
                       AND COALESCE(v.preco, 0) > 0 AND COALESCE(v.estoque_publicavel, 0) > 0),
    (SELECT count(*) FROM produtos pp WHERE pp.empresa_id = v_empresa AND pp.ativo)
  FROM loja_vitrine_produtos v
  WHERE v.loja_id = p_loja_id;
END;
$$;


-- ============================================================
-- 11. Privilégios — nada para o anônimo
--
-- A vitrine pública é servida pelo Next, com chave de serviço, no servidor.
-- O navegador do consumidor não fala com o banco. Portanto o papel `anon`
-- não recebe NADA daqui — nem a view, nem as funções.
-- ============================================================

REVOKE ALL ON loja_vitrine_produtos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON loja_vitrine_produtos TO authenticated;   -- só o painel do ERP

REVOKE ALL ON FUNCTION loja_buscar(UUID, TEXT, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_sugerir(UUID, TEXT, INTEGER)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_saude_catalogo(UUID)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_reindexar(UUID)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_reindexar_pendentes(UUID)             FROM PUBLIC, anon;
-- Gatilho, e SECURITY DEFINER: não fica alcançável pelo anônimo nem por
-- omissão. Ficou de fora da primeira rodada.
REVOKE ALL ON FUNCTION loja_produtos_indexar()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_atualizar_estoque_cache(UUID, UUID[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION loja_buscar(UUID, TEXT, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION loja_sugerir(UUID, TEXT, INTEGER)          TO authenticated;
GRANT EXECUTE ON FUNCTION loja_saude_catalogo(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION loja_reindexar(UUID)                       TO authenticated;
GRANT EXECUTE ON FUNCTION loja_reindexar_pendentes(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION loja_atualizar_estoque_cache(UUID, UUID[]) TO authenticated;


-- ============================================================
-- CONFERÊNCIA
--
--   -- acento e plural:
--   SELECT to_tsvector('public.pt_unaccent', 'Tubos Hidráulicos Soldáveis');
--   -- esperado: radicais sem acento (hidraul, sold, tub)
--
--   -- a consulta acha o que foi indexado:
--   SELECT websearch_to_tsquery('public.pt_unaccent','hidraulica')
--          @@ to_tsvector('public.pt_unaccent','MATERIAL HIDRÁULICO');
--   -- esperado: true
--
--   -- erro de digitação (o limiar 0,45 é aplicado dentro das funções):
--   SET pg_trgm.word_similarity_threshold = 0.45;
--   SELECT 'furaderia' <% 'furadeira de impacto bosch',   -- esperado: true
--          'hidralica' <% 'material hidraulico tubos',    -- esperado: true
--          'furadeira' <% 'tubo soldavel 20mm';           -- esperado: false
--
--   -- nada liberado para anon:
--   SELECT p.proname FROM pg_proc p
--    WHERE p.proname LIKE 'loja_%' AND has_function_privilege('anon', p.oid, 'EXECUTE');
--   SELECT has_table_privilege('anon','loja_vitrine_produtos','SELECT');
--   -- esperado: zero linhas, e false
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   DROP FUNCTION IF EXISTS loja_buscar(UUID,TEXT,UUID,TEXT,NUMERIC,NUMERIC,BOOLEAN,BOOLEAN,TEXT,INTEGER,INTEGER);
--   DROP FUNCTION IF EXISTS loja_sugerir(UUID,TEXT,INTEGER), loja_saude_catalogo(UUID);
--   DROP FUNCTION IF EXISTS loja_atualizar_estoque_cache(UUID,UUID[]), loja_reindexar(UUID);
--   DROP TRIGGER IF EXISTS trg_loja_produtos_indexar ON loja_produtos;
--   DROP FUNCTION IF EXISTS loja_produtos_indexar();
--   DROP VIEW IF EXISTS loja_vitrine_produtos;
--   DROP TEXT SEARCH CONFIGURATION IF EXISTS public.pt_unaccent;
-- As extensões podem ficar: não custam nada e não alteram comportamento.
-- ============================================================
