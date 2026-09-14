-- Editor da Home da Loja Online: gestão de banners (já existia a tabela,
-- faltava a tela) e um tipo novo de bloco — "destaque por tag": em vez de
-- escolher produtos um a um (`selecao`) ou depender do que o catálogo tem de
-- promoção/novidade, mostra os produtos que têm uma TAG específica, com
-- imagem, nome e preço vindos ao vivo do catálogo — visual de banner,
-- conteúdo de vitrine (preço nunca fica desatualizado, porque não é texto
-- digitado, é o mesmo preço que a listagem mostra).
--
-- Duas mudanças, nenhuma delas remove ou renomeia coluna:
--
--   1. `loja_vitrine_produtos` ganha a coluna `tags` — é a MESMA `produtos.tags`
--      que a tela de Produtos já usa para tags manuais, só que agora também
--      ATRAVESSA para a vitrine. Não é dado sensível (nem perto de
--      preco_custo/estoque/fornecedor), então entra na lista branca.
--   2. `loja_blocos_home.tipo` aceita o valor novo `'destaque_tag'`. O
--      `config` desse bloco é `{"tag": "nome-da-tag", "limite": 3}`.
--
-- Idempotente: pode rodar de novo sem efeito colateral.


-- ============================================================
-- 1. loja_vitrine_produtos — acrescenta `tags`
--
-- CREATE OR REPLACE (não DROP+CREATE) de propósito: preserva os GRANT/REVOKE
-- já aplicados e as dependências de quem já lê a view. A coluna nova vai no
-- FIM da lista — é a única posição em que `CREATE OR REPLACE VIEW` aceita
-- acrescentar coisa sem precisar recriar do zero.
-- ============================================================

CREATE OR REPLACE VIEW loja_vitrine_produtos AS
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
  lp.meta_description,

  -- ── Merchandising (novo) ─────────────────────────────────
  -- Tag manual do produto (`produtos.tags`, já usada na tela de Produtos).
  -- Serve para o bloco "destaque por tag" da Home escolher quem entra —
  -- não é categoria, não é marca, é uma etiqueta de campanha ("black-friday",
  -- "lancamento") que o operador decide na hora.
  COALESCE(p.tags, '{}')                                               AS tags
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

-- `CREATE OR REPLACE VIEW` preserva GRANT/REVOKE já aplicados, mas reafirmar
-- custa nada e documenta a regra no mesmo lugar de quem só ler este arquivo.
REVOKE ALL ON loja_vitrine_produtos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON loja_vitrine_produtos TO authenticated;   -- só o painel do ERP


-- ============================================================
-- 2. loja_blocos_home — novo tipo 'destaque_tag'
-- ============================================================

ALTER TABLE loja_blocos_home DROP CONSTRAINT IF EXISTS loja_blocos_tipo_chk;
ALTER TABLE loja_blocos_home ADD CONSTRAINT loja_blocos_tipo_chk CHECK (tipo IN
  ('destaques', 'ofertas', 'novidades', 'mais_vendidos', 'categorias', 'marcas', 'selecao', 'destaque_tag'));

COMMENT ON COLUMN loja_blocos_home.config IS
  'Depende de `tipo`. selecao: {"produto_ids": [...]}. destaque_tag: {"tag": "nome-da-tag"} — os produtos com essa tag em produtos.tags, com saldo e publicados, no visual de banner (imagem + nome + preço), não no grid pequeno dos outros tipos.';


-- ============================================================
-- Como conferir depois de rodar
--
--   select tags from loja_vitrine_produtos limit 3;
--   select conname from pg_constraint where conname = 'loja_blocos_tipo_chk';
--   select has_table_privilege('anon', 'loja_vitrine_produtos', 'SELECT'); -- false
-- ============================================================
