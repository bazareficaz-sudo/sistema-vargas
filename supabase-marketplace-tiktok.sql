-- Integração TikTok Shop — mesma tabela marketplace_canais das outras
-- plataformas, só falta um lugar para guardar o shop_cipher: toda chamada
-- autenticada da API da TikTok Shop exige esse valor (não é o mesmo que
-- seller_id/shop_id, que já tem coluna própria).
ALTER TABLE marketplace_canais ADD COLUMN IF NOT EXISTS shop_cipher TEXT;
