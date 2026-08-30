-- ============================================================
-- LOJA ONLINE — de onde vem o preço à vista
--
-- `supabase-loja-precos.sql` assumiu UM modelo: um percentual de desconto do
-- canal, valendo para o catálogo inteiro. A operação usa outro — a promoção
-- que já existe no ERP É o preço à vista, e quem não está em promoção tem um
-- preço só.
--
-- Os dois são legítimos e nenhum é derivável do outro, então viram opção.
--
--   'percentual' → desconto do canal sobre o preço praticado. Todo produto
--                  ganha segundo preço. É o padrão, e o que já estava no ar.
--
--   'promocao'   → o preço promocional do produto é o à vista; o de TABELA
--                  desce parcelado. Só quem está em promoção vigente tem dois
--                  preços. Medido em 29/08: 137 dos 534 publicados.
--
-- ── A diferença que não é de tela ───────────────────────────
--
-- Em 'promocao' o preço de tabela deixa de ser "o preço antigo, riscado" e
-- passa a ser "o preço de quem não paga à vista". Por isso o riscado SOME
-- nesse modo: riscar diria que ninguém paga aquele valor, e alguém paga.
--
-- E isso é decisão comercial, não ajuste de vitrine: hoje o balcão cobra o
-- promocional de todo mundo. Ligar 'promocao' é anunciar que no cartão se
-- paga a tabela. Quem opera precisa praticar isso, senão a loja diz uma
-- condição e o caixa pratica outra — que é o defeito que este projeto mais
-- persegue.
--
-- ── O que este arquivo NÃO muda ─────────────────────────────
--
-- `preco` e `preco_de` da view continuam exatamente como estavam. Ou seja: a
-- ordenação por preço, os filtros de faixa e o total do carrinho não mudam de
-- valor em modo nenhum. O que muda é a LEITURA que a vitrine faz deles, e
-- essa mora em `src/lib/commerce/precos.ts`.
--
-- Depende de supabase-loja-precos.sql. Aditivo.
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ── 1. A coluna ─────────────────────────────────────────────

ALTER TABLE loja_config
  -- 'percentual' e o padrao porque e o comportamento que ja estava no ar.
  ADD COLUMN IF NOT EXISTS avista_origem TEXT NOT NULL DEFAULT 'percentual';

ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_avista_origem_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_avista_origem_chk
  CHECK (avista_origem IN ('percentual', 'promocao'));

COMMENT ON COLUMN loja_config.avista_origem IS
  'percentual = desconto do canal sobre todo o catálogo. promocao = o preço promocional do produto é o à vista, e só ele tem dois preços.';


-- ── 2. A view respeita a origem ─────────────────────────────
--
-- Uma linha de diferenca em relacao a versao anterior: o percentual so
-- incide quando a origem é 'percentual'. Sem isso, ligar 'promocao' com um
-- percentual sobrando produziria DOIS precos a vista concorrentes — o do
-- percentual, no banco, e o da promocao, na tela.
--
-- O campo por produto (`loja_produtos.preco_pix`) continua ganhando dos dois:
-- e a excecao, e excecao que perde para a regra nao e excecao.

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

  p.peso_kg, p.comprimento_cm, p.largura_cm, p.altura_cm,

  pr.preco,
  CASE WHEN pr.preco_de > pr.preco THEN pr.preco_de END                AS preco_de,

  CASE
    WHEN lp.preco_pix IS NOT NULL AND lp.preco_pix < pr.preco THEN lp.preco_pix
    WHEN c.avista_origem = 'percentual'
         AND c.pix_desconto_pct > 0 AND pr.preco > 0
      THEN round(pr.preco * (1 - c.pix_desconto_pct / 100.0), 2)
  END                                                                  AS preco_pix,

  COALESCE(NULLIF(btrim(COALESCE(lp.imagem_principal_url, '')), ''),
           lp.imagem_vitrine)                                          AS imagem_url,

  COALESCE(lp.estoque_publicavel, 0)                                   AS estoque_publicavel,
  lp.estoque_cache_em,
  lp.limite_maximo_por_compra,

  COALESCE(NULLIF(btrim(COALESCE(lp.seo_title, '')), ''),
           COALESCE(NULLIF(btrim(lp.nome_comercial), ''), p.nome))     AS seo_title,
  lp.meta_description
FROM loja_produtos lp
JOIN produtos p    ON p.id = lp.produto_id
JOIN loja_config c ON c.id = lp.loja_id
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


-- ── 3. Privilégios, repostos ────────────────────────────────
-- Recriar a view APAGA os GRANTs dela, e o padrão do Supabase inclui `anon`.

REVOKE ALL ON loja_vitrine_produtos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON loja_vitrine_produtos TO authenticated;


-- ── 4. Recarregar o cache de esquema do PostgREST ───────────
--
-- Sem isto, salvar a aba Preços falha por alguns instantes com "Could not
-- find the 'avista_origem' column of 'loja_config' in the schema cache" —
-- para uma coluna que já existe. Aconteceu de verdade em 30/08 com
-- `parcela_minima`, e o operador viu um erro que não era erro dele.
--
-- Vale para toda migração que acrescente coluna que o painel grava.

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA
--
--   -- a que importa, sempre:
--   SELECT has_table_privilege('anon','loja_vitrine_produtos','SELECT');
--   -- esperado: false
--
--   -- quantos produtos teriam dois preços em cada modelo:
--   SELECT count(*) FILTER (WHERE preco_de IS NOT NULL) AS em_promocao,
--          count(*)                                     AS publicados
--     FROM loja_vitrine_produtos WHERE status='publicado' AND preco>0;
--
--   -- em 'promocao', o a vista de um produto e o proprio `preco`, e o
--   -- parcelado e o `preco_de`. Conferir alguns:
--   SELECT nome, preco AS avista_no_pix, preco_de AS parcelado
--     FROM loja_vitrine_produtos
--    WHERE status='publicado' AND preco_de IS NOT NULL
--    ORDER BY preco DESC LIMIT 10;
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   UPDATE loja_config SET avista_origem = 'percentual';
-- e, para remover de vez, derrubar a coluna e reexecutar
-- supabase-loja-precos.sql (que recria a view sem esta condição).
-- Nenhum preço de produto é alterado por este arquivo.
-- ============================================================
