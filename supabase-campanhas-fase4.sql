-- ============================================================
-- FASE 4 — MODELO CANÔNICO DE CAMPANHA: O QUE FALTA PARA O ML CABER
--
-- Auditoria de 01/09/2026: `marketplace_promocoes` e `marketplace_promocao_itens`
-- (criadas para a Shopee na Fase 2) cobrem a maior parte do modelo. Esta
-- migration acrescenta SÓ o que a API real do Mercado Livre provou existir e
-- que as colunas atuais não conseguem representar.
--
-- Nenhuma tabela nova. Nenhuma `mercadolivre_promocoes` paralela.
--
-- ── O DEFEITO QUE ESTA MIGRATION EXISTE PARA IMPEDIR ────────
--
-- `marketplace_promocao_itens` NÃO TEM STATUS. A vigência é decidida só no
-- nível da campanha (`vigenciaDaCampanha` olha encerrada/rascunho/programada)
-- e `itemDoAnuncio` aceita qualquer item que tenha preço.
--
-- Na Shopee isso nunca importou: item que está na campanha está participando.
-- No Mercado Livre não: uma campanha `started` contém itens `candidate` —
-- CONVIDADOS, não participantes. Sondagem real de 30/08:
--
--   LIGHTNING LGH-MLB1000 · status "started"
--     └ MLB5708867606 · status "candidate" · price 18.31 · original 19.27
--
-- Sem uma coluna de status por item, o primeiro sync de ML faria esse
-- `candidate` entrar em `resolverPrecoEfetivo` e MUDAR O PREÇO DE VENDA de um
-- anúncio que só foi convidado. Convite viraria preço.
--
-- É por isso que esta migration vem ANTES de qualquer sincronização de ML, e
-- não junto com ela.
--
-- ── O QUE MAIS A API PROVOU, E NÃO CABE HOJE ────────────────
--
--   promotion_type   LIGHTNING, PRICE_MATCHING, SMART, SELLER_CAMPAIGN, DEAL
--                    e eles NÃO têm o mesmo contrato: LIGHTNING não tem
--                    subsídio e tem `stock{min,max}`; PRICE_MATCHING e SMART
--                    têm `meli_percentage`/`seller_percentage`. Sem guardar o
--                    tipo, viram todos a mesma coisa.
--
--   min_discounted_price       o mínimo que o MARKETPLACE aceita — que não é,
--   suggested_discounted_price e nunca foi, o mínimo que a empresa aceita.
--                              Um anúncio de R$ 19,50 tinha mínimo ML de
--                              R$ 3,90: 80% de desconto. Guardar esse número
--                              com o nome "preço mínimo" seria convidar o
--                              erro operacional que a Fase 4 existe para
--                              evitar.
--
--   meli_percentage    quanto do desconto o marketplace banca. MEDIDO: os dois
--   seller_percentage  somam exatamente o desconto total, conferido em seis
--                      amostras. O que NÃO está medido é como isso vira
--                      dinheiro no bolso do vendedor — por isso as colunas
--                      guardam o percentual observado, e NÃO um valor
--                      calculado a partir dele.
--
--   start_date / end_date  o ML devolve janela POR ITEM, não só por campanha.
--
--   dados_brutos no item   tipo desconhecido não pode ser descartado
--                          (seção 46 do escopo): o sync grava o payload e
--                          marca `tipo_nao_mapeado`, em vez de quebrar.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. A campanha ganha tipo ────────────────────────────────
--
-- TEXT livre, não ENUM: a lista de `promotion_type` é do Mercado Livre, muda
-- sem avisar, e um ENUM faria o sync QUEBRAR ao encontrar um tipo novo —
-- exatamente o oposto do que a seção 46 pede.
ALTER TABLE marketplace_promocoes
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS tipo_mapeado BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN marketplace_promocoes.tipo IS
  'promotion_type da plataforma (ML: LIGHTNING, PRICE_MATCHING, SMART, SELLER_CAMPAIGN, DEAL). Tipos NAO tem contrato identico entre si — ver docs/precificacao-fase4-campanhas.md.';
COMMENT ON COLUMN marketplace_promocoes.tipo_mapeado IS
  'Falso quando o tipo apareceu na API mas seu contrato ainda nao foi inspecionado. A campanha e guardada e mostrada; o que nao se faz e supor que ela funciona como as ja conhecidas.';

-- ── 2. O item ganha status — a correção principal ───────────
--
-- `participando` e `candidato` sao coisas diferentes e so `participando` pode
-- influenciar preco efetivo. O DEFAULT e 'participando' de proposito: as
-- linhas que ja existem sao da Shopee, onde estar na campanha E participar.
-- Um default 'candidato' apagaria, em silencio, campanhas Shopee que hoje
-- valem preco.
ALTER TABLE marketplace_promocao_itens
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'participando',
  ADD COLUMN IF NOT EXISTS status_externo TEXT;

COMMENT ON COLUMN marketplace_promocao_itens.status IS
  'Canonico: participando | candidato | encerrado | desconhecido. SOMENTE participando pode alterar o preco efetivo do anuncio (ver precos.ts). Candidato e oportunidade comercial, nao preco.';
COMMENT ON COLUMN marketplace_promocao_itens.status_externo IS
  'O status cru da plataforma (ML: candidate, started, ...). Guardado ao lado do canonico para a traducao poder ser auditada e corrigida sem novo sync.';

-- ── 3. Os limites do MARKETPLACE, nomeados como tal ─────────
ALTER TABLE marketplace_promocao_itens
  ADD COLUMN IF NOT EXISTS preco_minimo_marketplace NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS preco_sugerido_marketplace NUMERIC(12,2);

COMMENT ON COLUMN marketplace_promocao_itens.preco_minimo_marketplace IS
  'min_discounted_price: o menor preco que a PLATAFORMA aceita. NAO e o piso da empresa. Observado R$ 3,90 num anuncio de R$ 19,50 — 80%% de desconto. Nunca exibir os dois com o mesmo rotulo.';
COMMENT ON COLUMN marketplace_promocao_itens.preco_sugerido_marketplace IS
  'suggested_discounted_price: sugestao da plataforma, nao recomendacao do Vargas. Precisa passar por avaliarPreco() antes de virar decisao.';

-- ── 4. Subsídio: guardar o observado, não o deduzido ────────
ALTER TABLE marketplace_promocao_itens
  ADD COLUMN IF NOT EXISTS pct_marketplace NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS pct_vendedor NUMERIC(6,2);

COMMENT ON COLUMN marketplace_promocao_itens.pct_marketplace IS
  'meli_percentage: parte do desconto bancada pela plataforma, em %% do preco original. MEDIDO: pct_marketplace + pct_vendedor = desconto total, conferido em 6 amostras. Como isso vira dinheiro recebido pelo vendedor NAO foi medido — nao derivar valor daqui sem confirmar contra um pedido liquidado.';
COMMENT ON COLUMN marketplace_promocao_itens.pct_vendedor IS
  'seller_percentage: parte do desconto bancada pelo vendedor, em %% do preco original.';

-- ── 5. Janela por item e payload bruto ──────────────────────
ALTER TABLE marketplace_promocao_itens
  ADD COLUMN IF NOT EXISTS inicio TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fim TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dados_brutos JSONB,
  -- Reconciliacao sem apagar: ver o bloco 7.
  ADD COLUMN IF NOT EXISTS visto_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS descoberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Decisao local do operador. NAO altera a plataforma.
  ADD COLUMN IF NOT EXISTS ignorado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignorado_por TEXT,
  ADD COLUMN IF NOT EXISTS ignorado_motivo TEXT;

COMMENT ON COLUMN marketplace_promocao_itens.descoberto_em IS
  'Quando esta oportunidade apareceu pela primeira vez. E o que permite dizer "23 anuncios novos elegiveis" — impossivel na reconciliacao por apagar-e-recriar, onde tudo e sempre novo.';
COMMENT ON COLUMN marketplace_promocao_itens.ignorado_em IS
  'O operador dispensou esta oportunidade. Local: nao mexe na plataforma, so para a Central de mostra-la como novidade a cada sync.';

-- ── 6. Chave estável do item ────────────────────────────────
--
-- Sem chave unica o upsert nao tem em que se apoiar e a reconciliacao volta a
-- ser apagar-e-recriar. `model_id` entra na chave porque a Shopee ja usa
-- variacao; COALESCE porque NULL nao se compara com NULL num indice unico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promocao_item_chave
  ON marketplace_promocao_itens (promocao_id, item_id_externo, COALESCE(model_id, ''));

-- A Central filtra por status e por oportunidade nova.
CREATE INDEX IF NOT EXISTS idx_promocao_itens_status
  ON marketplace_promocao_itens (status, promocao_id);
CREATE INDEX IF NOT EXISTS idx_promocao_itens_anuncio
  ON marketplace_promocao_itens (anuncio_id) WHERE anuncio_id IS NOT NULL;

-- ── 7. Por que NAO ha coluna "removido" ─────────────────────
--
-- A reconciliacao da Shopee hoje apaga todos os itens da campanha e reinsere
-- (promocoesSync.ts). Funciona para espelhar e destroi duas coisas que a
-- Fase 4 precisa: `descoberto_em` (nova oportunidade) e `ignorado_em`
-- (decisao do operador) — os dois voltariam do zero a cada sync.
--
-- Com `visto_em` a reconciliacao passa a ser: upsert do que veio, carimbando
-- `visto_em = agora`; o que ficou com `visto_em` antigo saiu da plataforma e
-- vira status 'encerrado'. A linha permanece, com historico e decisao intactos.
--
-- A troca do apagar-e-recriar pelo upsert e feita no CODIGO, e vale para as
-- duas plataformas. Esta migration so cria o que ela precisa.

-- ── 8. RLS ──────────────────────────────────────────────────
--
-- As duas tabelas ja existem desde a Fase 2 com a politica delas. Colunas
-- novas herdam a politica da tabela — nao ha o que acrescentar aqui, e
-- acrescentar por reflexo criaria politica duplicada. Conferir depois:
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('marketplace_promocoes','marketplace_promocao_itens');
