-- Qual preço entra no carrinho do PDV quando a promoção depende da forma de
-- pagamento ("preço promocional só no Pix/dinheiro").
--
--   'promocional'  o item entra com o preço da promoção e sobe para o normal
--                  se o cliente escolher cartão/carteira. É o comportamento
--                  de sempre — e o padrão.
--   'normal'       o item entra com o preço normal e desce para o
--                  promocional quando a forma escolhida dá direito.
--
-- Por que existir: em muitas lojas a maior parte das vendas sai no cartão ou
-- na carteira. Com o promocional na tela, o vendedor fala um preço e o caixa
-- cobra outro — e quem explica a diferença ao cliente é ele. Com o normal na
-- tela, o desconto vira boa notícia no fechamento, não má notícia.
--
-- Só tem efeito com promocao_exige_forma ligado: sem restrição a promoção
-- vale em qualquer forma, e não há outro preço para mostrar.

ALTER TABLE empresa_config_pdv
  ADD COLUMN IF NOT EXISTS promocao_preco_carrinho TEXT NOT NULL DEFAULT 'promocional';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresa_config_pdv_promocao_preco_carrinho_check'
  ) THEN
    ALTER TABLE empresa_config_pdv
      ADD CONSTRAINT empresa_config_pdv_promocao_preco_carrinho_check
      CHECK (promocao_preco_carrinho IN ('promocional', 'normal'));
  END IF;
END $$;

COMMENT ON COLUMN empresa_config_pdv.promocao_preco_carrinho IS
  'Preço que entra no carrinho do PDV quando a promoção exige forma de pagamento: promocional (padrão) ou normal.';
