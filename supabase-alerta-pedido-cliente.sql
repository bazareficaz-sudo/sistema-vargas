-- ============================================================
-- AVISO DE COMPRA POR WHATSAPP, POR CLIENTE
--
-- Caso que motivou: um escritório que compra muito aqui, com vários
-- funcionários autorizados. O dono quer receber um WhatsApp sempre que
-- alguém comprar em nome da firma — para saber na hora o que foi comprado
-- e por quem.
--
-- É recurso de poucos clientes, não de todos: fica desligado por padrão e
-- é ligado um a um, no cadastro do cliente.
--
-- `alerta_pedido_telefone` existe porque o número de quem RECEBE o aviso
-- costuma não ser o número do cadastro: o telefone do cliente é o do
-- balcão/escritório, e quem quer o aviso é o dono, no celular dele. Vazio,
-- cai na cadeia que o resto do sistema já usa
-- (telefone_whatsapp > whatsapp > telefone).
-- ============================================================

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS alerta_pedido_whatsapp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerta_pedido_telefone TEXT;

COMMENT ON COLUMN clientes.alerta_pedido_whatsapp IS
  'Quando true, envia um WhatsApp avisando cada compra feita em nome deste cliente. Desligado por padrão.';
COMMENT ON COLUMN clientes.alerta_pedido_telefone IS
  'Número que recebe o aviso de compra. Vazio usa telefone_whatsapp > whatsapp > telefone do cadastro.';

-- O envio confere em whatsapp_mensagens se já avisou aquela venda, para
-- não mandar duas vezes quando a rotina roda de novo. Sem este índice a
-- conferência varre a tabela inteira a cada rodada.
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_referencia
  ON whatsapp_mensagens(referencia_tipo, referencia_id);

-- ── Conferência ──────────────────────────────────────────────
--   SELECT nome, alerta_pedido_whatsapp, alerta_pedido_telefone
--   FROM clientes WHERE alerta_pedido_whatsapp;
