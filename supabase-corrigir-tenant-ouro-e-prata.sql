-- ============================================================
-- Corrige cadastro: "Bazar Ouro e Prata" deveria estar no mesmo
-- tenant/grupo do "Bazar Eficaz" (mesmo dono, cadastrada por engano
-- como cliente separado). Não afeta assinatura/plano/Mercado Pago
-- (subscriptions é vinculada por empresa_id, não por tenant).
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

UPDATE empresas
SET tenant_id = 'b0000000-0000-0000-0000-000000000001',
    grupo_id  = 'c0000000-0000-0000-0000-000000000001'
WHERE id = '681ab72f-fd5b-4de9-8623-59eeb32e6d18';

UPDATE profiles
SET tenant_id = 'b0000000-0000-0000-0000-000000000001',
    grupo_id  = 'c0000000-0000-0000-0000-000000000001'
WHERE id = 'bcaeef51-9dd2-4f2c-bd5b-bd351dafe607';

-- Verificação rápida (deve devolver as duas linhas já com o tenant_id novo):
-- SELECT id, nome_fantasia, tenant_id, grupo_id FROM empresas WHERE id = '681ab72f-fd5b-4de9-8623-59eeb32e6d18';
-- SELECT id, tenant_id, grupo_id FROM profiles WHERE id = 'bcaeef51-9dd2-4f2c-bd5b-bd351dafe607';
