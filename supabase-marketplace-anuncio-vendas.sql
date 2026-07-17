-- Quantidade de vendas do anúncio, vinda do endpoint Shopee
-- get_item_extra_info (campo "sale" — "sales volume of item"). Preenchida
-- na sincronização (completa ou individual); nula até o primeiro sync
-- depois desta migration.

ALTER TABLE marketplace_anuncios
  ADD COLUMN IF NOT EXISTS vendas INTEGER;
