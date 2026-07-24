-- ============================================================
-- Cobrança recorrente via Mercado Pago (assinatura com plano associado).
-- mercadopago_plan_id fica na plans (criado uma vez, por plano, quando o
-- admin vincula a cobrança recorrente em saas-admin/planos).
-- mercadopago_preapproval_id/mercadopago_status ficam por assinatura —
-- cada empresa que assina gera a sua própria preapproval no Mercado Pago.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS mercadopago_plan_id TEXT;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS mercadopago_preapproval_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS mercadopago_status TEXT;
