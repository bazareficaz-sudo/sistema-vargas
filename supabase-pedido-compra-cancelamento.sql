-- Cancelamento de pedido ao fornecedor.
--
-- O status 'cancelado' já era previsto pela tela, mas não havia como chegar
-- nele: nenhum botão, nenhuma rota. Pedido errado ficava para sempre na lista
-- como rascunho ou enviado.
--
-- Cancelar não é apagar. Um pedido que já foi enviado ao fornecedor existiu no
-- mundo — o fornecedor viu, pode ter separado mercadoria, pode cobrar. Apagar
-- essa linha some com a explicação de por que o pedido #000001 não virou
-- entrada nenhuma. Por isso o cancelamento guarda quando e por quê.

ALTER TABLE pedidos_compra
  ADD COLUMN IF NOT EXISTS cancelado_em    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_motivo TEXT;

COMMENT ON COLUMN pedidos_compra.cancelado_em IS
  'Quando o pedido foi cancelado. NULL = não cancelado. O status continua sendo a fonte de verdade; isto é o registro de quando.';
COMMENT ON COLUMN pedidos_compra.cancelado_motivo IS
  'Motivo informado por quem cancelou — é o que explica, meses depois, por que o pedido não virou entrada.';
