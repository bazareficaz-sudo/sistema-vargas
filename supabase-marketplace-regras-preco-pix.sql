-- Toggle por regra para considerar (ou não) o subsídio Pix da Shopee no
-- cálculo de "Margem líquida sobre custo".
ALTER TABLE marketplace_regras_preco
  ADD COLUMN IF NOT EXISTS considerar_subsidio_pix BOOLEAN NOT NULL DEFAULT false;
