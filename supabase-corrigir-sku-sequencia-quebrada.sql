-- ============================================================
-- SKU — corrigir sequência quebrada por número de telefone digitado
-- à mão, e fechar a porta que deixou isso acontecer
--
-- Medido em 17/09/2026, empresa Bazar Eficaz (a1000000-0000-0000-0000-000000000001):
-- o produto "KIT 5 Bits PONTEIRA PHILIPS..." nasceu em 14/09 com SKU
-- 21998266150 — um número de celular (DDD 21), digitado no campo de SKU do
-- Novo Produto, que até então era um <input> comum, livre para editar.
--
-- proximo_sku_numerico() (supabase-proximo-sku.sql) calcula "maior SKU
-- puramente numérico já cadastrado + 1". Sem noção nenhuma do que é um SKU
-- plausível pra este catálogo, ela aceitou o número de telefone como o novo
-- "maior SKU" e passou a contar a partir dele — daí os 10 produtos
-- seguintes (14 a 16/09) terem herdado 21998266151 a 21998266160, um atrás
-- do outro, cada um só porque o anterior tinha acabado de puxar a régua.
--
-- O SKU legítimo mais alto da empresa nessa data era 25745 (14.551 produtos
-- com numeração normal) — os 11 produtos abaixo voltam a contar dali,
-- na mesma ordem em que foram criados.
--
-- A causa (SKU editável em 5 telas de cadastro de produto) já foi corrigida
-- no código desta mesma leva — este arquivo só limpa o estrago já feito e
-- reforça a trava também no banco, pro caso de outro caminho (import,
-- migração, chamada direta à função) repetir o erro.
-- ============================================================

-- 1. Corrigir os 11 produtos, na ordem em que foram criados.
UPDATE produtos SET sku = '25746' WHERE id = '676988db-5037-49e1-a6cb-3a015ad7101a'; -- era 21998266150 · 14/09 13:08
UPDATE produtos SET sku = '25747' WHERE id = 'b8d0580a-a102-490a-ae5e-46f066afb475'; -- era 21998266151 · 15/09 11:30
UPDATE produtos SET sku = '25748' WHERE id = 'f515cec7-8133-497b-8337-b52a3f93dc8a'; -- era 21998266152 · 15/09 15:23
UPDATE produtos SET sku = '25749' WHERE id = 'bc671857-140a-43f5-89b1-5f318c67634e'; -- era 21998266153 · 15/09 15:35
UPDATE produtos SET sku = '25750' WHERE id = '9e6f1e8a-820f-488c-9265-dfd1b16df590'; -- era 21998266154 · 16/09 11:43:55
UPDATE produtos SET sku = '25751' WHERE id = '82086c57-ad50-4046-b6ca-708aa2af21bc'; -- era 21998266155 · 16/09 11:43:59
UPDATE produtos SET sku = '25752' WHERE id = '87536c44-3f40-4a42-9a96-de45d517584e'; -- era 21998266156 · 16/09 11:44:01
UPDATE produtos SET sku = '25753' WHERE id = '9a7fedb8-41e8-41a3-9137-927a512230aa'; -- era 21998266157 · 16/09 11:44:04
UPDATE produtos SET sku = '25754' WHERE id = '011e4a5a-f59a-4d87-9343-7af4ccb831e3'; -- era 21998266158 · 16/09 11:47:06
UPDATE produtos SET sku = '25755' WHERE id = '82d71c43-e33d-45ae-b9c3-1e13fd487e70'; -- era 21998266159 · 16/09 11:52:42
UPDATE produtos SET sku = '25756' WHERE id = '619a8ff6-f903-4590-8da9-f9e939769e7e'; -- era 21998266160 · 16/09 23:06:28

-- 2. Reforçar a função: nenhum SKU com mais de 7 dígitos entra na conta do
--    "maior SKU" — dá pra crescer até 9.999.999 produtos (o catálogo real
--    tem ~14 mil) sem esbarrar no teto, e qualquer coisa de 8+ dígitos
--    (telefone, CPF, EAN, CNPJ) fica de fora automaticamente.
CREATE OR REPLACE FUNCTION proximo_sku_numerico(p_empresa_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT (COALESCE(MAX(sku::BIGINT), 0) + 1)::TEXT
  FROM produtos
  WHERE empresa_id = p_empresa_id
    AND sku ~ '^[0-9]+$'
    AND length(sku) <= 7
$$;

-- ── Conferência ──────────────────────────────────────────────
--   -- nenhuma linha deve voltar (os 11 SKUs velhos não existem mais):
--   SELECT id, sku FROM produtos WHERE sku LIKE '21998266%';
--
--   -- deve devolver 25757:
--   SELECT proximo_sku_numerico('a1000000-0000-0000-0000-000000000001');
