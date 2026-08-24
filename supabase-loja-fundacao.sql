-- ============================================================
-- LOJA ONLINE — Fase 1: fundação
--
-- A Loja Online é um CANAL DE VENDA, não um sistema paralelo. O catálogo
-- continua sendo `produtos`; o estoque continua sendo `produto_estoque`; o
-- pedido vai nascer em `marketplace_pedidos` (Fase 3). O que estas tabelas
-- guardam é só o que pertence AO CANAL: o que está publicado, com que texto,
-- com que preço, e de qual estoque.
--
-- REGRA QUE ORGANIZA O ARQUIVO INTEIRO:
--   nada aqui duplica produto, preço ou saldo.
--   `loja_produtos` é uma linha POR PUBLICAÇÃO, não um segundo cadastro.
--
-- Tudo é aditivo. Nenhum DROP, nenhum ALTER em tabela existente, nenhum
-- UPDATE em dado existente. Rodar este arquivo não muda o comportamento de
-- nada que já está no ar — ERP, PDV, app e marketplaces seguem idênticos.
--
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 0. Utilitário — slug
--
-- URL amigável é requisito de SEO do projeto (`/produto/furadeira-bosch-650w`
-- em vez de `/produto?id=93829`). Fica no banco, e não na aplicação, porque
-- quem gera slug em massa é a publicação em lote — 14 mil produtos passando
-- por JavaScript seria uma viagem de ida e volta por linha.
--
-- IMMUTABLE de propósito: assim pode ser usada em índice e em coluna gerada
-- se um dia for preciso.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_slugify(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT trim(both '-' from
    regexp_replace(
      regexp_replace(
        lower(translate(
          p_texto,
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
        )),
        '[^a-z0-9]+', '-', 'g'      -- tudo que não é letra/número vira hífen
      ),
      '-{2,}', '-', 'g'             -- hifens repetidos viram um só
    )
  );
$$;

COMMENT ON FUNCTION loja_slugify(TEXT) IS
  'Texto livre → slug de URL. Usada na publicação em massa de produtos e categorias.';


-- ============================================================
-- 1. loja_config — uma linha por loja
--
-- A loja SEMPRE pertence a um canal (`marketplace_canais` com
-- plataforma='loja_online'), e o canal pertence a uma empresa. É essa
-- corrente que sustenta o multiempresa:
--
--   hostname → loja_config → canal → empresa → grupo → tenant
--
-- Nada nesta tabela conhece "Bazar Eficaz". A empresa piloto é só a primeira
-- linha inserida.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  -- Uma loja por canal. O canal é quem dá identidade de "canal de venda" à
  -- loja dentro do ERP (aparece em Pedidos, em regras de preço, etc.).
  canal_id      UUID NOT NULL REFERENCES marketplace_canais(id) ON DELETE CASCADE,

  ativo         BOOLEAN NOT NULL DEFAULT false,
  -- Loja no ar mas fechada ao público: útil para montar o catálogo antes de
  -- divulgar o endereço. Diferente de `ativo=false`, que some do roteamento.
  em_manutencao BOOLEAN NOT NULL DEFAULT true,

  -- ── Endereço na web ────────────────────────────────────────
  -- `subdominio` é o caminho padrão (bazareficaz.dominio.com.br).
  -- `dominio_proprio` é o futuro (loja.cliente.com.br). Os dois resolvem
  -- para a mesma loja; o roteamento tenta domínio próprio primeiro.
  subdominio      TEXT NOT NULL,
  dominio_proprio TEXT,

  -- ── Identidade ─────────────────────────────────────────────
  nome            TEXT NOT NULL,
  descricao       TEXT,
  logo_url        TEXT,
  favicon_url     TEXT,
  telefone        TEXT,
  whatsapp        TEXT,
  email           TEXT,
  cep             TEXT,
  logradouro      TEXT,
  numero          TEXT,
  complemento     TEXT,
  bairro          TEXT,
  cidade          TEXT,
  uf              TEXT,
  instagram       TEXT,
  facebook        TEXT,
  tiktok          TEXT,
  horario_atendimento TEXT,

  -- ── Aparência ──────────────────────────────────────────────
  -- Personalização controlada, não construtor de site: uma cor de marca e um
  -- acento. O resto vem do design system, que é o que garante que a loja não
  -- fique feia por configuração.
  cor_primaria    TEXT NOT NULL DEFAULT '#1d4ed8',
  cor_destaque    TEXT NOT NULL DEFAULT '#0f766e',

  -- ── SEO ────────────────────────────────────────────────────
  seo_title        TEXT,
  meta_description TEXT,
  og_image_url     TEXT,
  -- Enquanto false, a loja manda `noindex`. Evita o Google indexar uma
  -- vitrine em montagem, que é o tipo de erro que custa semanas para desfazer.
  indexavel        BOOLEAN NOT NULL DEFAULT false,

  -- ══ POLÍTICA DE ESTOQUE DO CANAL ═══════════════════════════
  --
  -- Decisão de 24/08/2026: de onde vem o saldo publicado é configuração da
  -- loja, nunca constante no código. Cada empresa (e, no futuro, cada tenant)
  -- decide sozinha.
  --
  --   deposito_unico        → um depósito escolhido
  --   depositos_selecionados→ soma dos depósitos em `loja_estoque_depositos`
  --   empresa_consolidado   → todos os depósitos ativos da empresa
  --   grupo_consolidado     → soma do grupo, RESPEITANDO as regras que já
  --                           existem (ver §6 e a função de estoque)
  estoque_modo TEXT NOT NULL DEFAULT 'deposito_unico'
    CONSTRAINT loja_config_estoque_modo_chk CHECK (estoque_modo IN
      ('deposito_unico', 'depositos_selecionados', 'empresa_consolidado', 'grupo_consolidado')),

  estoque_deposito_id UUID REFERENCES depositos(id) ON DELETE SET NULL,

  -- Qual das duas fontes de saldo do ERP vale para a loja.
  --   produto_estoque → tabela por depósito (recomendado)
  --   produto_campo   → `produtos.estoque`, o escalar
  -- As duas divergem em 540 produtos (medido em 14/08). A escolha fica
  -- explícita na tela, com o número da divergência ao lado, em vez de ser
  -- decisão escondida no código.
  estoque_fonte TEXT NOT NULL DEFAULT 'produto_estoque'
    CONSTRAINT loja_config_estoque_fonte_chk CHECK (estoque_fonte IN ('produto_estoque', 'produto_campo')),

  -- ── Políticas de exposição do saldo ────────────────────────
  -- Retido de toda venda online. Protege o balcão de vender o que a vitrine
  -- já prometeu.
  estoque_seguranca NUMERIC NOT NULL DEFAULT 0
    CONSTRAINT loja_config_seguranca_chk CHECK (estoque_seguranca >= 0),

  -- Percentual do disponível que a loja pode anunciar. 100 = tudo.
  estoque_percentual_publicado NUMERIC NOT NULL DEFAULT 100
    CONSTRAINT loja_config_percentual_chk CHECK (estoque_percentual_publicado > 0 AND estoque_percentual_publicado <= 100),

  -- Teto absoluto do que a vitrine mostra. NULL = sem teto.
  -- Serve para não expor o tamanho real do estoque ao concorrente.
  estoque_maximo_publicado INTEGER
    CONSTRAINT loja_config_maximo_chk CHECK (estoque_maximo_publicado IS NULL OR estoque_maximo_publicado > 0),

  permitir_venda_sem_estoque BOOLEAN NOT NULL DEFAULT false,

  -- Decisão de 24/08: configurável.
  --   ocultar              → some da listagem e da busca
  --   mostrar_indisponivel → continua visível, botão desabilitado
  -- Em AMBOS os casos a página do produto continua acessível pela URL: tirar
  -- a página do ar quebraria link já compartilhado no WhatsApp e faria o
  -- Google despublicar a URL — semanas para recuperar.
  sem_estoque_comportamento TEXT NOT NULL DEFAULT 'mostrar_indisponivel'
    CONSTRAINT loja_config_sem_estoque_chk CHECK (sem_estoque_comportamento IN ('ocultar', 'mostrar_indisponivel')),

  limite_maximo_por_compra INTEGER
    CONSTRAINT loja_config_limite_chk CHECK (limite_maximo_por_compra IS NULL OR limite_maximo_por_compra > 0),

  -- Quanto tempo uma reserva de checkout sobrevive (Fase 2/3).
  reserva_minutos INTEGER NOT NULL DEFAULT 30
    CONSTRAINT loja_config_reserva_chk CHECK (reserva_minutos BETWEEN 5 AND 1440),

  -- ── Modalidades de entrega (Fase 3) ────────────────────────
  -- Nascem desligadas. Estão aqui para a Fase 1 já modelar o pedido sabendo
  -- que existem duas formas de o cliente receber.
  entrega_ativa  BOOLEAN NOT NULL DEFAULT true,
  retirada_ativa BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT loja_config_canal_unico UNIQUE (canal_id)
);

-- Subdomínio e domínio próprio são a chave de roteamento: precisam ser
-- únicos no sistema inteiro, não por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loja_config_subdominio
  ON loja_config (lower(subdominio));
CREATE UNIQUE INDEX IF NOT EXISTS idx_loja_config_dominio
  ON loja_config (lower(dominio_proprio)) WHERE dominio_proprio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loja_config_empresa ON loja_config (empresa_id);

COMMENT ON TABLE loja_config IS
  'Uma loja online. Resolve-se pelo hostname; pertence a um canal, que pertence a uma empresa.';
COMMENT ON COLUMN loja_config.estoque_modo IS
  'De onde vem o saldo publicado. grupo_consolidado respeita estoque_unificado_participantes e produto_vinculos — nunca soma empresas por conta própria.';


-- ============================================================
-- 2. loja_estoque_depositos — quais depósitos entram na soma
--
-- Só vale quando estoque_modo = 'depositos_selecionados'. Tabela separada, e
-- não um array em loja_config, porque cada linha vai ganhar atributo próprio
-- (ordem de separação, prazo de retirada) nas fases seguintes.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_estoque_depositos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id     UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  deposito_id UUID NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,
  -- Ordem de preferência para separar o pedido (Fase 3).
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_estoque_dep_unico UNIQUE (loja_id, deposito_id)
);

CREATE INDEX IF NOT EXISTS idx_loja_estoque_dep_loja ON loja_estoque_depositos (loja_id);


-- ============================================================
-- 3. loja_categorias — navegação comercial
--
-- Independente da categoria do ERP de propósito. No ERP a categoria é TEXTO
-- (não chave), está duplicada e tem acento quebrado — e arrumar isso é outro
-- projeto, que mexe em dezenas de telas e relatórios.
--
-- Aqui a árvore é comercial:
--     ERP:  "MATERIAL HIDRÁULICO" | "MATERIAL HIDRAULICO" | "Material Hidráulico"
--     Loja: Hidráulica → Tubos e Conexões → Tubos PVC
--
-- É a `loja_categoria_origens` que faz as três grafias caírem no mesmo lugar,
-- sem UPDATE nenhum em `produtos`.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id     UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  pai_id      UUID REFERENCES loja_categorias(id) ON DELETE CASCADE,

  -- Vínculo OPCIONAL com a categoria do ERP. Opcional porque a árvore
  -- comercial pode ter nós que não existem no cadastro interno.
  categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,

  nome        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  descricao   TEXT,
  imagem_url  TEXT,
  ordem       INTEGER NOT NULL DEFAULT 0,
  destaque    BOOLEAN NOT NULL DEFAULT false,
  ativo       BOOLEAN NOT NULL DEFAULT true,

  seo_title        TEXT,
  meta_description TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT loja_categorias_slug_unico UNIQUE (loja_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_loja_categorias_loja ON loja_categorias (loja_id, ativo, ordem);
CREATE INDEX IF NOT EXISTS idx_loja_categorias_pai  ON loja_categorias (pai_id);

-- ── Mapeamento: texto do ERP → nó comercial ─────────────────
-- Várias grafias apontam para a mesma categoria da loja. É assim que a
-- faxina de categorias acontece na vitrine sem tocar no cadastro.
CREATE TABLE IF NOT EXISTS loja_categoria_origens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id           UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  loja_categoria_id UUID NOT NULL REFERENCES loja_categorias(id) ON DELETE CASCADE,
  -- Guardado normalizado (minúsculo, sem acento) para casar as variações.
  origem_chave      TEXT NOT NULL,
  -- Como estava escrito no ERP, para a tela conseguir mostrar ao operador.
  origem_rotulo     TEXT NOT NULL,
  -- 'categoria' | 'subcategoria' — de qual campo do produto veio.
  origem_campo      TEXT NOT NULL DEFAULT 'categoria'
    CONSTRAINT loja_cat_origem_campo_chk CHECK (origem_campo IN ('categoria', 'subcategoria')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_categoria_origem_unica UNIQUE (loja_id, origem_campo, origem_chave)
);

CREATE INDEX IF NOT EXISTS idx_loja_cat_origens_cat ON loja_categoria_origens (loja_categoria_id);


-- ============================================================
-- 4. loja_produtos — a publicação
--
-- UMA LINHA POR PRODUTO PUBLICADO NUMA LOJA. Não é cópia de `produtos`:
-- não tem estoque, não tem custo, não tem dado fiscal. Tem só o que o
-- canal acrescenta.
--
-- Preço: `preco_loja` é OPCIONAL. Vazio significa "usa o preço do ERP" — que
-- é o caso da esmagadora maioria e evita 14 mil preços duplicados que
-- envelhecem em silêncio.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_produtos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id    UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'rascunho'
    CONSTRAINT loja_produtos_status_chk CHECK (status IN
      ('nao_publicado', 'rascunho', 'publicado', 'pausado')),

  slug TEXT NOT NULL,

  -- ── Conteúdo comercial (tudo opcional) ─────────────────────
  -- Decisão de 24/08: o usuário publica o que quiser, mesmo sem nada disto
  -- preenchido. Vazio cai no cadastro do ERP.
  nome_comercial     TEXT,
  descricao_curta    TEXT,
  descricao_completa TEXT,
  caracteristicas    JSONB NOT NULL DEFAULT '[]'::jsonb,
  especificacoes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  aplicacoes         TEXT,
  palavras_chave     TEXT[] NOT NULL DEFAULT '{}',

  -- ── SEO ────────────────────────────────────────────────────
  seo_title        TEXT,
  meta_description TEXT,

  imagem_principal_url TEXT,

  -- ── Preço do canal (opcional) ──────────────────────────────
  preco_loja  NUMERIC CONSTRAINT loja_produtos_preco_chk CHECK (preco_loja IS NULL OR preco_loja >= 0),
  preco_pix   NUMERIC CONSTRAINT loja_produtos_pix_chk   CHECK (preco_pix  IS NULL OR preco_pix  >= 0),
  -- O "de" riscado. Só aparece se for MAIOR que o preço efetivo — a regra é
  -- da aplicação, mas o campo é este.
  preco_de    NUMERIC CONSTRAINT loja_produtos_de_chk    CHECK (preco_de   IS NULL OR preco_de   >= 0),
  promo_inicio TIMESTAMPTZ,
  promo_fim    TIMESTAMPTZ,

  -- ── Sobrescritas da política de estoque, por produto ───────
  estoque_seguranca        NUMERIC,
  estoque_maximo_publicado INTEGER,
  limite_maximo_por_compra INTEGER,

  -- ── Vitrine ────────────────────────────────────────────────
  destaque BOOLEAN NOT NULL DEFAULT false,
  ordem    INTEGER NOT NULL DEFAULT 0,

  -- De onde veio o conteúdo, quando foi importado de um canal existente.
  -- 'erp' = nada foi importado, usa o cadastro.
  conteudo_origem TEXT NOT NULL DEFAULT 'erp'
    CONSTRAINT loja_produtos_origem_chk CHECK (conteudo_origem IN
      ('erp', 'manual', 'shopee', 'mercadolivre', 'nuvemshop')),

  -- ── Busca (preenchida por loja_produto_reindexar) ──────────
  -- Denormalizada aqui, e não em `produtos`, por dois motivos: só produto
  -- publicado precisa ser buscável (centenas, não 28 mil), e o índice
  -- precisa juntar campo do ERP com campo do canal — o que uma coluna
  -- gerada não consegue fazer, porque não enxerga outra tabela.
  busca       TSVECTOR,
  busca_texto TEXT,

  publicado_em  TIMESTAMPTZ,
  publicado_por UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT loja_produtos_unico      UNIQUE (loja_id, produto_id),
  CONSTRAINT loja_produtos_slug_unico UNIQUE (loja_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_loja_produtos_vitrine
  ON loja_produtos (loja_id, status, ordem) WHERE status = 'publicado';
CREATE INDEX IF NOT EXISTS idx_loja_produtos_produto ON loja_produtos (produto_id);
CREATE INDEX IF NOT EXISTS idx_loja_produtos_destaque
  ON loja_produtos (loja_id, destaque) WHERE destaque AND status = 'publicado';

COMMENT ON TABLE loja_produtos IS
  'Publicação de um produto numa loja. NÃO é cópia do cadastro: sem estoque, sem custo, sem fiscal.';
COMMENT ON COLUMN loja_produtos.preco_loja IS
  'Preço específico do canal. NULL = usa o preço do ERP. Deixar nulo é o caso normal.';


-- ── Produto × categoria comercial ───────────────────────────
-- Explícito, para permitir que um produto apareça em mais de um nó da árvore
-- (uma torneira é "Hidráulica" e também "Cozinha"). Quando vazio, a vitrine
-- cai no mapeamento automático por `loja_categoria_origens`.
CREATE TABLE IF NOT EXISTS loja_produto_categorias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id           UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  loja_produto_id   UUID NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
  loja_categoria_id UUID NOT NULL REFERENCES loja_categorias(id) ON DELETE CASCADE,
  principal         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_prod_cat_unico UNIQUE (loja_produto_id, loja_categoria_id)
);

CREATE INDEX IF NOT EXISTS idx_loja_prod_cat_categoria ON loja_produto_categorias (loja_categoria_id);


-- ── Galeria da loja ─────────────────────────────────────────
-- Separada de `produto_imagens` porque a foto boa para o marketplace nem
-- sempre é a boa para a vitrine, e porque a loja precisa de `alt` (que o
-- cadastro não tem) — sem ele não há acessibilidade nem SEO de imagem.
CREATE TABLE IF NOT EXISTS loja_produto_imagens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id         UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  loja_produto_id UUID NOT NULL REFERENCES loja_produtos(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  alt             TEXT,
  ordem           INTEGER NOT NULL DEFAULT 0,
  principal       BOOLEAN NOT NULL DEFAULT false,
  -- true quando o arquivo já foi copiado para o bucket próprio. Imagem
  -- hotlinkada de CDN de terceiro (209 das 277 de hoje) quebra sem aviso.
  hospedada       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loja_prod_img ON loja_produto_imagens (loja_produto_id, ordem);


-- ============================================================
-- 5. Home configurável — banners e blocos
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id     UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  posicao     TEXT NOT NULL DEFAULT 'hero'
    CONSTRAINT loja_banners_posicao_chk CHECK (posicao IN ('hero', 'intermediario')),
  titulo      TEXT,
  subtitulo   TEXT,
  imagem_url  TEXT,
  -- Arte específica de celular. A mesma imagem de desktop cortada no celular
  -- é a causa mais comum de banner ilegível — e a maioria do tráfego vem do
  -- WhatsApp, ou seja, do celular.
  imagem_mobile_url TEXT,
  link_url    TEXT,
  cta_texto   TEXT,
  ordem       INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  inicio_em   TIMESTAMPTZ,
  fim_em      TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loja_banners_loja ON loja_banners (loja_id, posicao, ordem) WHERE ativo;

CREATE TABLE IF NOT EXISTS loja_blocos_home (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id    UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL
    CONSTRAINT loja_blocos_tipo_chk CHECK (tipo IN
      ('destaques', 'ofertas', 'novidades', 'mais_vendidos', 'categorias', 'marcas', 'selecao')),
  titulo     TEXT NOT NULL,
  subtitulo  TEXT,
  limite     INTEGER NOT NULL DEFAULT 8
    CONSTRAINT loja_blocos_limite_chk CHECK (limite BETWEEN 2 AND 24),
  ordem      INTEGER NOT NULL DEFAULT 0,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  -- Para tipo='selecao': { "produto_ids": [...] }. Fora daí, folga para o
  -- bloco ganhar opção sem migração.
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loja_blocos_loja ON loja_blocos_home (loja_id, ordem) WHERE ativo;


-- ============================================================
-- 6. estoque_reservas — a peça que não existia
--
-- O sistema NÃO tinha reserva de estoque. `empresa_config_estoque` tem
-- `reservar_em_pedido` desde sempre, mas nenhum código lê esse campo, e
-- `marketplace_anuncios.estoque_reservado` é o estoque PUBLICADO no canal, não
-- reserva. A baixa de marketplace deixa o saldo ir negativo de propósito
-- (ver src/lib/produtos/estoque.ts): o sistema ABSORVE overselling.
--
-- Para marketplace isso é defensável — o pedido já está vendido. Para uma
-- vitrine onde o cliente escolhe na hora, não é.
--
-- A tabela nasce AQUI, na Fase 1, e nasce VAZIA. A Fase 1 não escreve nela;
-- só a função de disponibilidade já a subtrai. Assim a Fase 2 (checkout com
-- reserva) é o caminho de escrita, e não uma mudança na leitura de todo mundo.
--
-- Genérica de propósito: `canal_id` nulo é reserva do balcão. Serve loja,
-- PDV, orçamento e marketplace sem tabela nova.
-- ============================================================

CREATE TABLE IF NOT EXISTS estoque_reservas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_id  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  deposito_id UUID REFERENCES depositos(id) ON DELETE SET NULL,
  canal_id    UUID REFERENCES marketplace_canais(id) ON DELETE SET NULL,

  quantidade  NUMERIC NOT NULL
    CONSTRAINT estoque_reservas_qtd_chk CHECK (quantidade > 0),

  -- Quem segurou: 'loja_carrinho' | 'loja_pedido' | 'orcamento' | 'venda' | ...
  referencia_tipo TEXT NOT NULL,
  referencia_id   TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'ativa'
    CONSTRAINT estoque_reservas_status_chk CHECK (status IN
      ('ativa', 'consumida', 'expirada', 'cancelada')),

  -- NULL = reserva sem prazo (pedido confirmado à espera de separação).
  expira_em  TIMESTAMPTZ,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  encerrado_em TIMESTAMPTZ,
  observacao TEXT
);

-- O índice que a função de disponibilidade usa em toda listagem. Parcial:
-- reserva encerrada não entra em conta nenhuma e não precisa ocupar índice.
CREATE INDEX IF NOT EXISTS idx_estoque_reservas_ativas
  ON estoque_reservas (produto_id, empresa_id) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS idx_estoque_reservas_expiracao
  ON estoque_reservas (expira_em) WHERE status = 'ativa' AND expira_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_reservas_ref
  ON estoque_reservas (referencia_tipo, referencia_id);

COMMENT ON TABLE estoque_reservas IS
  'Reserva temporária de estoque, de qualquer canal. Criada na Fase 1 e usada só na leitura; a escrita entra na Fase 2.';


-- ============================================================
-- 7. Carrinho — estrutura, ainda não o motor
--
-- Na Fase 1 o carrinho do visitante vive no navegador, e o servidor só
-- confere preço e disponibilidade na hora de exibir. Estas tabelas existem
-- para a Fase 3 não precisar de migração no meio do checkout, e para o
-- carrinho abandonado virar dado de analytics quando chegar a hora.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_carrinhos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id    UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  -- Visitante: token opaco guardado em cookie httpOnly.
  token      TEXT NOT NULL,
  -- Preenchido quando o visitante se identifica. NUNCA cria cadastro
  -- paralelo: aponta para `clientes`, que é o cadastro único do ERP.
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'aberto'
    CONSTRAINT loja_carrinhos_status_chk CHECK (status IN ('aberto', 'convertido', 'abandonado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_carrinhos_token_unico UNIQUE (loja_id, token)
);

CREATE INDEX IF NOT EXISTS idx_loja_carrinhos_cliente ON loja_carrinhos (cliente_id) WHERE cliente_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS loja_carrinho_itens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrinho_id UUID NOT NULL REFERENCES loja_carrinhos(id) ON DELETE CASCADE,
  produto_id  UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  quantidade  NUMERIC NOT NULL CONSTRAINT loja_carrinho_qtd_chk CHECK (quantidade > 0),
  -- Preço no momento em que entrou. É o que permite avisar "o preço mudou"
  -- em vez de trocar o valor por baixo do cliente.
  preco_unitario NUMERIC NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_carrinho_item_unico UNIQUE (carrinho_id, produto_id)
);


-- ============================================================
-- 8. loja_eventos — analytics sem PII
--
-- Base para conversão, recomendação e, mais adiante, o assistente de compras.
-- NUNCA guarda nome, telefone, e-mail ou CPF: só o token de sessão, que é
-- opaco e descartável. Isso é decisão de LGPD, não de espaço em disco.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_eventos (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  loja_id    UUID NOT NULL,
  tipo       TEXT NOT NULL,        -- pagina | busca | ver_produto | add_carrinho | checkout | compra
  sessao     TEXT,                 -- token opaco, sem identidade
  produto_id UUID,
  termo      TEXT,
  resultados INTEGER,
  valor      NUMERIC,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loja_eventos_loja ON loja_eventos (loja_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loja_eventos_produto ON loja_eventos (produto_id, created_at DESC) WHERE produto_id IS NOT NULL;


-- ============================================================
-- 9. loja_clientes_acesso — ponte, não cadastro novo
--
-- "Minha conta" precisa de identidade (auth.users). O cadastro do cliente
-- continua em `clientes`, que é onde o PDV, o fiado e o histórico já vivem.
-- Duplicar o cliente criaria dois cadastros da mesma pessoa — o erro que
-- este projeto já pagou caro com produtos e categorias.
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_clientes_acesso (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  loja_id    UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loja_cliente_acesso_unico UNIQUE (loja_id, user_id)
);


-- ============================================================
-- 10. updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION loja_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['loja_config','loja_categorias','loja_produtos','loja_carrinhos','loja_carrinho_itens']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION loja_touch_updated_at()', t, t);
  END LOOP;
END $$;


-- ============================================================
-- 11. SEGURANÇA — RLS e privilégios
--
-- DOIS controles, de propósito, e nenhum dos dois sozinho basta:
--
--   RLS       → o painel do ERP (sessão de usuário) só enxerga a própria
--               empresa, pelas MESMAS funções que o resto do sistema usa.
--   REVOKE    → o papel `anon` não toca em nada disto. Não confiar no padrão:
--               o Supabase concede ALL em tabela nova para anon e
--               authenticated, e foi exatamente assim que 28.593 produtos
--               com preco_custo ficaram legíveis sem login.
--
-- A vitrine pública NÃO usa nenhum destes caminhos: ela lê pelo servidor,
-- por views de lista branca (arquivo supabase-loja-vitrine.sql).
-- ============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loja_config','loja_estoque_depositos','loja_categorias','loja_categoria_origens',
    'loja_produtos','loja_produto_categorias','loja_produto_imagens',
    'loja_banners','loja_blocos_home','estoque_reservas',
    'loja_carrinhos','loja_carrinho_itens','loja_eventos','loja_clientes_acesso'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Nenhum privilégio para o anônimo. Nem SELECT.
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
  END LOOP;
END $$;

-- Política única, pelas funções que o resto do sistema já usa.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loja_config','loja_estoque_depositos','loja_categorias','loja_categoria_origens',
    'loja_produtos','loja_produto_categorias','loja_produto_imagens',
    'loja_banners','loja_blocos_home','estoque_reservas','loja_clientes_acesso'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_do_grupo', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL TO authenticated
                      USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
                      WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin())$p$,
                   t || '_do_grupo', t);
  END LOOP;
END $$;

-- Funções utilitárias também precisam de REVOKE explícito.
--
-- O padrão do Supabase concede EXECUTE por omissão, inclusive para `anon`.
-- Isto ficou de fora na primeira rodada e só apareceu ao rodar de verdade a
-- consulta de conferência do fim deste arquivo — que até então era só um
-- comentário. `loja_produtos_indexar` (em supabase-loja-vitrine.sql) é
-- SECURITY DEFINER, e é o que torna o descuido caro.
--
-- Os gatilhos seguem funcionando: gatilho roda com o privilégio do dono da
-- tabela, não de quem fez o INSERT.
REVOKE ALL ON FUNCTION loja_slugify(TEXT)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_touch_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION loja_slugify(TEXT) TO authenticated;

-- Carrinho e eventos: nem o painel do ERP precisa ler linha a linha. Ficam
-- sem política nenhuma para `authenticated` — só o servidor, com chave de
-- serviço, alcança. Menos gente enxergando, menos superfície.
DROP POLICY IF EXISTS loja_carrinhos_do_grupo ON loja_carrinhos;
CREATE POLICY loja_carrinhos_do_grupo ON loja_carrinhos
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS loja_eventos_do_grupo ON loja_eventos;
CREATE POLICY loja_eventos_do_grupo ON loja_eventos
  FOR SELECT TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());


-- ============================================================
-- CONFERÊNCIA — rode depois e leia o resultado
--
-- 1) Nenhuma tabela nova pode aparecer aqui com privilégio para anon:
--
--   SELECT table_name, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_name LIKE 'loja_%'
--       OR grantee = 'anon' AND table_name = 'estoque_reservas';
--
--   Resultado esperado: ZERO linhas.
--
-- 2) Nenhuma FUNÇÃO da loja liberada para anon (rode de verdade, não só leia):
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'loja\_%'
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
--   Resultado esperado: ZERO linhas.
--
-- 3) RLS ligada em todas:
--
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname LIKE 'loja_%' OR relname = 'estoque_reservas';
--
--   Resultado esperado: relrowsecurity = true em todas.
-- ============================================================


-- ============================================================
-- COMO DESFAZER
--
--   DROP TABLE IF EXISTS loja_carrinho_itens, loja_carrinhos, loja_eventos,
--     loja_clientes_acesso, loja_produto_imagens, loja_produto_categorias,
--     loja_produtos, loja_categoria_origens, loja_categorias, loja_banners,
--     loja_blocos_home, loja_estoque_depositos, loja_config, estoque_reservas CASCADE;
--   DROP FUNCTION IF EXISTS loja_slugify(TEXT), loja_touch_updated_at();
--
-- Nenhuma tabela existente foi alterada por este arquivo. Desfazer não toca
-- em produto, venda, pedido, estoque ou cliente.
-- ============================================================
