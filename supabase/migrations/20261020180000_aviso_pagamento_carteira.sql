-- Aviso de pagamento por WhatsApp e fim da forma "Fiado".
--
-- O cliente já recebia aviso de COMPRA (clientes.alerta_pedido_whatsapp).
-- Agora recebe também quando PAGA: a rotina de 5 em 5 minutos lê os
-- recebimentos novos — venham do PDV externo, da tela de Contas a Receber
-- ou do recebimento em massa — e manda o valor pago e o saldo que ficou.
--
--   clientes.alerta_pagamento_whatsapp  avisar os pagamentos deste cliente
--   recebimentos.avisar_cliente         escolha feita na hora da baixa:
--                                       true/false manda; null = vale o
--                                       cadastro do cliente
--   recebimentos.aviso_enviado_em       já avisado (não manda de novo)

alter table public.clientes add column if not exists alerta_pagamento_whatsapp boolean not null default false;
alter table public.recebimentos add column if not exists avisar_cliente boolean;
alter table public.recebimentos add column if not exists aviso_enviado_em timestamptz;

-- "Fiado" e "Carteira" eram a mesma coisa com dois nomes; fica a Carteira.
update public.forma_pagamento set ativo = false, updated_at = now() where codigo = 'fiado' and ativo;
