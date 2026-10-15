-- RESPOSTA CITADA no WhatsApp: o cliente segura uma mensagem (ex.: a foto de
-- um produto que a loja mandou), toca em "Responder" e escreve "quero esse".
-- A Z-API manda o id da mensagem respondida (`referenceMessageId`); ele fica
-- em `resposta_a` e a tela mostra a citação em cima da resposta.
--
-- A mensagem citada é achada pelo `zapi_message_id` (id do WhatsApp), que
-- passa a ser gravado também nas mensagens recebidas. O índice serve a essa
-- busca e à atualização de status de entrega (que já procurava por ele).
--
-- Aditiva e idempotente.

ALTER TABLE whatsapp_mensagens ADD COLUMN IF NOT EXISTS resposta_a TEXT;
COMMENT ON COLUMN whatsapp_mensagens.resposta_a IS 'Id (WhatsApp) da mensagem que esta responde, quando o cliente usou "Responder".';

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_zapi_message_id
  ON whatsapp_mensagens (empresa_id, zapi_message_id) WHERE zapi_message_id IS NOT NULL;
