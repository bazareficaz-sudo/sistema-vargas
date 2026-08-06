-- ============================================================
-- CPF/CNPJ na nota sem exigir cadastro de cliente
--
-- A NFC-e já sabia identificar o destinatário, mas só quando a venda estava
-- amarrada a um cliente CADASTRADO que tivesse CPF preenchido. No balcão o
-- pedido comum é outro: "põe meu CPF na nota", sem virar cadastro.
--
-- Resultado medido na base: das 96 NFC-e emitidas (91 autorizadas), ZERO
-- saíram identificadas — nenhuma venda tinha cliente vinculado.
--
-- Esta coluna guarda o documento informado na hora da venda. `cliente_nome`
-- já existia e passa a ser usado junto (a emissão o ignorava).
-- ============================================================

ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS cliente_cpf_cnpj TEXT;

COMMENT ON COLUMN vendas.cliente_cpf_cnpj IS
  'CPF/CNPJ informado na venda para sair na NFC-e, quando não há cliente cadastrado. Só dígitos.';
