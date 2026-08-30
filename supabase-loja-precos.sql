-- ============================================================
-- LOJA ONLINE — política de preços da vitrine
--
-- Responde uma pergunta que a Fase 1 deixou sem dono:
--
--     "qual preço a vitrine mostra, e em quantas condições?"
--
-- Até aqui a resposta era UMA só — `preco` — e um `loja_produtos.preco_pix`
-- opcional que ninguém preenche. Com 533 produtos publicados, um campo
-- manual por produto é o mesmo que não ter preço à vista nenhum: dá trabalho
-- de 533 digitações para render uma linha na tela.
--
-- Isto troca a digitação por POLÍTICA: um percentual do Pix e uma regra de
-- parcelamento, definidos uma vez, valendo para o catálogo inteiro. O campo
-- por produto continua existindo — como exceção, que é o papel dele.
--
-- ── O que a vitrine passa a mostrar ─────────────────────────
--
-- Com `preco_exibicao = 'dois_precos'`, cada produto mostra dois preços:
--
--     R$ 100,00  em até 10x de R$ 10,00 sem juros     ← o preço normal
--     R$  89,00  à vista no Pix                       ← o preço à vista
--
-- E quando o produto está em promoção vigente, os dois trocam de lugar: o
-- à vista sobe para o topo, em destaque, e o normal desce com o
-- parcelamento. A promoção é a hora de o menor preço ser a primeira coisa
-- que o olho encontra.
--
-- ── Por que NASCE DESLIGADA ─────────────────────────────────
--
-- `preco_exibicao` entra como 'preco_unico', que é exatamente o que a loja
-- faz hoje. A vitrine está NO AR: uma migração que muda preço na tela de 533
-- produtos no instante em que roda não é uma migração, é um susto. Ligar é
-- um clique em Loja Online → Preços, depois de conferir na prévia.
--
-- ── O que este arquivo NÃO faz ──────────────────────────────
--
-- Não cobra, não integra gateway e não promete meio de pagamento nenhum: o
-- checkout é a Fase 3. O parcelamento aqui é INFORMAÇÃO de vitrine, do mesmo
-- tipo que o orçamento já imprime em `src/lib/orcamentos/condicoes.ts` — e
-- usa o mesmo vocabulário de propósito, para a loja não dizer ao cliente uma
-- condição diferente da que o balcão diz.
--
-- Depende de supabase-loja-fundacao.sql e supabase-loja-vitrine.sql.
-- Aditivo: nenhuma coluna existente muda de tipo, nenhum dado é reescrito.
--
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. As colunas da política
-- ============================================================

ALTER TABLE loja_config
  -- 'preco_unico'  → o que a loja faz hoje: um preço, e o Pix embaixo se
  --                  alguém tiver preenchido o campo do produto.
  -- 'dois_precos'  → preço normal com parcelamento + preço à vista no Pix.
  ADD COLUMN IF NOT EXISTS preco_exibicao TEXT NOT NULL DEFAULT 'preco_unico',

  -- Desconto do à vista, em percentual sobre o preço praticado. 0 = sem
  -- segundo preço. É o único lugar onde esse número mora.
  ADD COLUMN IF NOT EXISTS pix_desconto_pct NUMERIC NOT NULL DEFAULT 0,

  -- Como o à vista se chama na tela. Configurável porque nem toda loja
  -- chama de Pix — há quem pratique o mesmo desconto em dinheiro e débito,
  -- e escrever "no Pix" nesse caso recusa venda no balcão.
  --
  -- Aceita NULL de propósito: o painel grava NULL quando o campo é apagado
  -- (é o que a rota de configuração faz com todo texto vazio), e a leitura
  -- cai em "no Pix". NOT NULL aqui transformaria apagar o campo em erro.
  ADD COLUMN IF NOT EXISTS pix_rotulo TEXT DEFAULT 'no Pix',

  -- Em quantas vezes a vitrine diz que dá para parcelar.
  -- NULL = não fala de parcelamento. Não é o mesmo que 1.
  ADD COLUMN IF NOT EXISTS parcelas_max INTEGER,

  -- Até quantas SEM juros. Zero com `parcelas_max` preenchido significa
  -- "parcela, mas com juros" — e aí `parcelas_juros_mes` precisa existir,
  -- senão a leitura não oferece nada (ver a regra em src/lib/commerce/precos.ts).
  ADD COLUMN IF NOT EXISTS parcelas_sem_juros INTEGER NOT NULL DEFAULT 0,

  -- Juros ao mês das parcelas acima do limite sem juros. Tabela Price, a
  -- mesma conta do cartão. 0 = a loja não parcela com juros.
  ADD COLUMN IF NOT EXISTS parcelas_juros_mes NUMERIC NOT NULL DEFAULT 0,

  -- Piso da parcela. Sem ele, um produto de R$ 4,90 anuncia "10x de R$ 0,49"
  -- — que não é uma oferta, é uma tela quebrada. R$ 5,00 é o piso usual do
  -- varejo, e é o padrão aqui.
  ADD COLUMN IF NOT EXISTS parcela_minima NUMERIC NOT NULL DEFAULT 5;


-- Travas. Idempotentes: derruba e recria, para reexecutar o arquivo não dar
-- erro de constraint duplicada.
ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_preco_exibicao_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_preco_exibicao_chk
  CHECK (preco_exibicao IN ('preco_unico', 'dois_precos'));

-- Teto de 90%: acima disso não é desconto à vista, é erro de digitação —
-- e um erro de digitação aqui vira preço errado em 533 páginas de uma vez.
ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_pix_desconto_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_pix_desconto_chk
  CHECK (pix_desconto_pct >= 0 AND pix_desconto_pct <= 90);

ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_parcelas_max_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_parcelas_max_chk
  CHECK (parcelas_max IS NULL OR (parcelas_max BETWEEN 2 AND 24));

ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_parcelas_sj_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_parcelas_sj_chk
  CHECK (parcelas_sem_juros BETWEEN 0 AND 24);

ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_parcelas_juros_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_parcelas_juros_chk
  CHECK (parcelas_juros_mes >= 0 AND parcelas_juros_mes <= 20);

ALTER TABLE loja_config DROP CONSTRAINT IF EXISTS loja_config_parcela_minima_chk;
ALTER TABLE loja_config ADD  CONSTRAINT loja_config_parcela_minima_chk
  CHECK (parcela_minima >= 0);


COMMENT ON COLUMN loja_config.preco_exibicao IS
  'preco_unico = um preço na vitrine. dois_precos = preço normal com parcelamento + preço à vista.';
COMMENT ON COLUMN loja_config.pix_desconto_pct IS
  'Desconto do preço à vista, em % sobre o preço praticado (que já inclui promoção vigente). 0 = sem segundo preço.';
COMMENT ON COLUMN loja_config.parcela_minima IS
  'Piso da parcela. A vitrine reduz o número de vezes até a parcela alcançar este valor.';


-- ============================================================
-- 2. A view, agora com o preço à vista calculado
--
-- Recriada inteira, e não alterada: `CREATE OR REPLACE VIEW` não aceita
-- mudança na lista de colunas, e o JOIN novo com `loja_config` muda o FROM.
-- O conteúdo abaixo é o da Fase 1 com DUAS diferenças — o JOIN e a coluna
-- `preco_pix`. Tudo o mais é idêntico, incluindo a lista branca.
--
-- Por que o cálculo mora AQUI e não no TypeScript: quem lê esta view é a
-- listagem, a busca, a página do produto e a conferência do carrinho. Em
-- código de tela, o percentual seria aplicado em quatro lugares — e este
-- projeto já pagou por duas implementações da mesma regra que se afastaram
-- (o filtro de entrada de mercadoria).
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

  -- ── Preço à vista (Pix) ──────────────────────────────────
  -- Vem da POLÍTICA da loja, e não de digitação produto a produto: com 533
  -- publicados, um campo manual é um preço à vista que nunca existe.
  -- `loja_produtos.preco_pix` continua valendo como exceção, e ganha do
  -- percentual.
  --
  -- O percentual incide sobre `pr.preco`, que JÁ é o promocional quando há
  -- promoção vigente. É isso que faz o Pix ser o menor preço da vitrine em
  -- vez de concorrer com a promoção.
  --
  -- NULL quando não há segundo preço — NULL, e não o preço repetido, para a
  -- vitrine nunca ter de decidir se "R$ 100 no Pix" ao lado de "R$ 100" é
  -- oferta ou defeito.
  CASE
    WHEN lp.preco_pix IS NOT NULL AND lp.preco_pix < pr.preco THEN lp.preco_pix
    WHEN c.pix_desconto_pct > 0 AND pr.preco > 0
      THEN round(pr.preco * (1 - c.pix_desconto_pct / 100.0), 2)
  END                                                                  AS preco_pix,

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
JOIN produtos p    ON p.id = lp.produto_id
-- A política de preços mora na loja, e por isso ela entra aqui. Sem este
-- JOIN o percentual do Pix teria de ser aplicado na aplicação, e a busca, o
-- card e o carrinho voltariam a calcular cada um o seu.
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


-- ============================================================
-- 3. Privilégios — repostos
--
-- Recriar a view APAGA os GRANTs dela. Esquecer esta seção deixaria a view
-- com o padrão do banco, e o padrão não é o que este projeto quer: a vitrine
-- pública não recebe chave nenhuma, e `anon` não vê nada.
-- ============================================================

REVOKE ALL ON loja_vitrine_produtos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON loja_vitrine_produtos TO authenticated;   -- só o painel do ERP


-- ============================================================
-- CONFERÊNCIA
--
--   -- 1. a view não pode ter voltado a ser legível pelo anônimo:
--   SELECT has_table_privilege('anon', 'loja_vitrine_produtos', 'SELECT');
--   -- esperado: false
--
--   -- 2. com a política desligada (padrão), NADA muda na vitrine.
--   --    O único preco_pix que sobra é o digitado produto a produto:
--   SELECT count(*) FILTER (WHERE preco_pix IS NOT NULL) AS com_avista,
--          count(*)                                      AS publicados
--     FROM loja_vitrine_produtos WHERE status = 'publicado';
--
--   -- 3. simular a política ANTES de ligar — quanto ficaria o à vista:
--   SELECT nome, preco,
--          round(preco * (1 - 5 / 100.0), 2) AS avista_com_5pct
--     FROM loja_vitrine_produtos
--    WHERE status = 'publicado' AND preco > 0
--    ORDER BY preco DESC LIMIT 20;
--
--   -- 4. quantos produtos ficariam SEM parcelamento por causa do piso
--   --    da parcela (com parcela_minima = 5, o padrão):
--   SELECT count(*) FILTER (WHERE preco < 10) AS sem_parcelamento,
--          count(*)                           AS publicados
--     FROM loja_vitrine_produtos WHERE status = 'publicado' AND preco > 0;
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--
-- Para voltar a vitrine ao comportamento anterior, sem desfazer nada:
--   UPDATE loja_config SET preco_exibicao = 'preco_unico';
--
-- Para remover de fato (a view volta ao arquivo da Fase 1 — reexecute
-- supabase-loja-vitrine.sql DEPOIS de derrubar as colunas):
--   ALTER TABLE loja_config
--     DROP COLUMN IF EXISTS preco_exibicao,
--     DROP COLUMN IF EXISTS pix_desconto_pct,
--     DROP COLUMN IF EXISTS pix_rotulo,
--     DROP COLUMN IF EXISTS parcelas_max,
--     DROP COLUMN IF EXISTS parcelas_sem_juros,
--     DROP COLUMN IF EXISTS parcelas_juros_mes,
--     DROP COLUMN IF EXISTS parcela_minima;
--
-- Nenhum preço de produto é alterado por este arquivo, em nenhum dos dois
-- sentidos. Ele muda o que a vitrine MOSTRA, nunca o que o ERP cobra.
-- ============================================================
