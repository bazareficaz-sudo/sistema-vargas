-- Promoções de marketplace — fatia 1: espelho de leitura da Shopee.
--
-- POR QUE TABELA NOVA, E NÃO OS CAMPOS QUE JÁ EXISTEM
--
-- `marketplace_anuncios` tem `preco_promocional`, `promo_inicio` e
-- `promo_fim` desde o começo, e em 27/08/2026 os 1.286 anúncios Shopee
-- estavam com os três NULOS: ninguém nunca escreveu neles. Seria tentador
-- reaproveitá-los, mas eles não cabem no modelo da plataforma.
--
-- Na Shopee, desconto NÃO é um atributo do anúncio: é uma CAMPANHA da loja,
-- com nome e uma janela só, contendo muitos itens — e o mesmo anúncio pode
-- estar em campanhas diferentes ao longo do tempo. Três colunas no anúncio
-- guardariam um retrato do agora e perderiam a campanha a que ele pertence,
-- que é justamente o que se gerencia.
--
-- A promoção do ERP (`produtos.promocao_ativa` + `preco_promocional` +
-- janela, 252 produtos hoje) também continua sendo outra coisa: é a promoção
-- do balcão. Marketplace tem margem própria. As duas convivem de propósito,
-- e ligá-las é decisão de tela, não de banco.

-- ── Campanha ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketplace_promocoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  canal_id          UUID NOT NULL REFERENCES public.marketplace_canais(id) ON DELETE CASCADE,
  -- `discount_id` da Shopee. Nulo enquanto a campanha só existir aqui
  -- (fatia 2, quando a tela passar a criar).
  id_externo        TEXT,
  nome              TEXT NOT NULL,
  inicio            TIMESTAMPTZ,
  fim               TIMESTAMPTZ,
  -- Vocabulário da própria Shopee (upcoming/ongoing/expired), traduzido:
  -- 'programada', 'ativa', 'encerrada'. 'rascunho' é o estado local de quem
  -- ainda não foi publicado.
  status            TEXT NOT NULL DEFAULT 'rascunho',
  sincronizado_em   TIMESTAMPTZ,
  dados_brutos      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chave de reconciliação do sync: a mesma campanha relida não vira linha
-- nova. Parcial porque campanha ainda não publicada tem id_externo nulo, e
-- várias delas podem coexistir.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promocoes_canal_externo
  ON public.marketplace_promocoes (canal_id, id_externo)
  WHERE id_externo IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_promocoes_canal_status
  ON public.marketplace_promocoes (canal_id, status);

-- ── Item da campanha ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketplace_promocao_itens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id       UUID NOT NULL REFERENCES public.marketplace_promocoes(id) ON DELETE CASCADE,
  -- Vínculo com o anúncio local, quando ele existe. NULO é situação legítima
  -- e esperada: a campanha pode conter item que o catálogo local ainda não
  -- sincronizou. Apagar o anúncio não apaga o item da campanha — por isso
  -- SET NULL, e por isso `item_id_externo` é a identidade de verdade.
  anuncio_id        UUID REFERENCES public.marketplace_anuncios(id) ON DELETE SET NULL,
  item_id_externo   TEXT NOT NULL,
  item_nome         TEXT,
  -- Variação. A Shopee cobra preço por `model_id` em anúncio com variação, e
  -- item sem variação usa `item_promotion_price` direto — daí o nulo.
  model_id          TEXT,
  preco_original    NUMERIC(12,2),
  preco_promocional NUMERIC(12,2),
  -- `purchase_limit`: teto por comprador. 0 = sem limite, na convenção dela.
  limite_por_compra INTEGER,
  estoque_promocao  INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Item sem variação e item com variação convivem na mesma tabela, então a
-- unicidade precisa tratar `model_id` nulo como valor. COALESCE resolve sem
-- inventar uma coluna sentinela.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_promocao_itens_chave
  ON public.marketplace_promocao_itens (promocao_id, item_id_externo, COALESCE(model_id, ''));

CREATE INDEX IF NOT EXISTS marketplace_promocao_itens_anuncio
  ON public.marketplace_promocao_itens (anuncio_id);

-- ── updated_at ───────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_promocoes_updated_at ON public.marketplace_promocoes;
CREATE TRIGGER trg_promocoes_updated_at BEFORE UPDATE ON public.marketplace_promocoes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_promocao_itens_updated_at ON public.marketplace_promocao_itens;
CREATE TRIGGER trg_promocao_itens_updated_at BEFORE UPDATE ON public.marketplace_promocao_itens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- Copia a policy de `marketplace_anuncios` — `anuncios_do_grupo` — em vez de
-- inventar outra: promoção pertence ao mesmo módulo e à mesma empresa que o
-- anúncio, e duas regras de visibilidade diferentes para dados do mesmo dono
-- é como um lado passa a mostrar o que o outro esconde.
--
-- Sem policy a tabela nasce invisível para o cliente do navegador e a tela
-- lista vazio, sem erro nenhum — falha silenciosa e cara de diagnosticar.

ALTER TABLE public.marketplace_promocoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_promocao_itens  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promocoes_do_grupo ON public.marketplace_promocoes;
CREATE POLICY promocoes_do_grupo ON public.marketplace_promocoes
  FOR ALL
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- O item herda a visibilidade da campanha: não tem `empresa_id` próprio de
-- propósito, para não existir a possibilidade de os dois discordarem.
DROP POLICY IF EXISTS promocao_itens_do_grupo ON public.marketplace_promocao_itens;
CREATE POLICY promocao_itens_do_grupo ON public.marketplace_promocao_itens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.marketplace_promocoes p
     WHERE p.id = promocao_id
       AND (empresa_do_meu_grupo(p.empresa_id) OR is_system_admin())))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.marketplace_promocoes p
     WHERE p.id = promocao_id
       AND (empresa_do_meu_grupo(p.empresa_id) OR is_system_admin())));
