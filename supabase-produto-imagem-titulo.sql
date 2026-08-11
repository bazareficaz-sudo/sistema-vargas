-- ============================================================
-- Título por imagem do produto
--
-- Serve para o envio por WhatsApp: cada imagem vai com o seu título como
-- legenda, para quem recebe saber o que está vendo. Uma sequência de cinco
-- fotos sem legenda obriga o cliente a adivinhar qual é qual.
--
-- Opcional por natureza: imagem sem título é enviada sem legenda, que é o
-- comportamento de hoje.
-- ============================================================

ALTER TABLE produto_imagens
  ADD COLUMN IF NOT EXISTS titulo TEXT;

COMMENT ON COLUMN produto_imagens.titulo IS
  'Legenda da imagem. Vai como caption no envio por WhatsApp; vazio envia sem legenda.';


-- ── Conferência ─────────────────────────────────────────────

SELECT count(*) AS imagens, count(titulo) AS com_titulo FROM produto_imagens;
