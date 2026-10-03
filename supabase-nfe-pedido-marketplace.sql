-- ============================================================
-- NF-e (modelo 55) dos pedidos de marketplace
-- Execute no Supabase Dashboard → SQL Editor
--
-- Lógica em src/lib/fiscal/emitirNfePedido.ts (busca) e nfePedido.ts
-- (montagem). Só ACRESCENTA colunas: nada existente muda.
-- ============================================================

-- Marketplace que intermediou a venda — a NF-e de venda por marketplace leva
-- o CNPJ dele e a identificação do vendedor lá (grupo infIntermed, NT
-- 2020.006). Por canal, porque cada conta é de uma empresa e de um site.
-- intermediador_id vazio = usa o seller_id do canal.
ALTER TABLE marketplace_canais ADD COLUMN IF NOT EXISTS intermediador_cnpj TEXT;
ALTER TABLE marketplace_canais ADD COLUMN IF NOT EXISTS intermediador_id   TEXT;

-- Resultado da última tentativa de emissão, inteiro: ambiente, status,
-- número, chave, protocolo, DANFE, XML, motivo da rejeição, emitente e o
-- resumo do que foi enviado (CFOP/CST por item). Uma coluna JSONB em vez de
-- dez porque o conjunto muda com o provedor e só a tela do pedido lê.
--
-- nfe_numero / nfe_chave (que já existem e são o que a esteira e as
-- etiquetas usam) só são preenchidos por nota AUTORIZADA EM PRODUÇÃO. Nota
-- de homologação não tem valor fiscal e não pode fazer o pedido parecer
-- faturado.
ALTER TABLE marketplace_pedidos ADD COLUMN IF NOT EXISTS nfe_status  TEXT;
ALTER TABLE marketplace_pedidos ADD COLUMN IF NOT EXISTS nfe_emissao JSONB;
-- O destinatário como foi usado na nota (CPF, endereço) — para conferir
-- depois e para não buscar de novo no marketplace a cada tentativa.
ALTER TABLE marketplace_pedidos ADD COLUMN IF NOT EXISTS destinatario_fiscal JSONB;
