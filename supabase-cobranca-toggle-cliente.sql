-- ============================================================
-- COBRANÇA AUTOMÁTICA POR CLIENTE — LIGA/DESLIGA
--
-- Alguns clientes ficam incomodados em receber lembrete de dívida por
-- WhatsApp (extrato de conta, situação da conta). Isso é diferente de
-- `clientes.opt_out_whatsapp`, que já existe e desliga TUDO (pedido
-- confirmado, promoção, etc.) — aqui é só a parte de cobrança que para,
-- o resto da comunicação continua.
--
-- Padrão TRUE (ligado) — mantém o comportamento de hoje pra quem não mexer.
-- ============================================================

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cobranca_whatsapp_ativa BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN clientes.cobranca_whatsapp_ativa IS
  'Quando false, bloqueia envio de mensagens de cobrança (extrato/situação da conta) por WhatsApp pra este cliente — outras mensagens (pedido, promoção) continuam normalmente. Diferente de opt_out_whatsapp, que bloqueia tudo.';

-- ── Conferência ──────────────────────────────────────────────
--   SELECT count(*) FILTER (WHERE cobranca_whatsapp_ativa = false) AS desligaram_cobranca FROM clientes;
