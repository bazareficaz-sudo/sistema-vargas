-- Pedido: em Configurações, ligar/desligar o botão "Comprar" na LISTAGEM
-- (card pequeno) do produto — hoje ele só existe na página do produto
-- (`ComprarProduto.tsx`), de propósito: comprar sem escolher quantidade
-- "levava de volta pra trás" (ver comentário em CardProduto.tsx). Isto dá a
-- escolha ao lojista em vez de a decisão ficar só no código.
--
-- Padrão `false`: quem não mexer continua vendo exatamente a loja de hoje.

ALTER TABLE loja_config
  ADD COLUMN IF NOT EXISTS mostrar_botao_comprar_listagem BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN loja_config.mostrar_botao_comprar_listagem IS
  'Mostra um botão de compra rápida (quantidade 1) nos cards da listagem/busca, além do fluxo normal na página do produto.';

NOTIFY pgrst, 'reload schema';
