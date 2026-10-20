-- Editar valor e vencimento de uma conta a pagar direto na lista.
--
-- Na primeira edição, o valor e o vencimento de antes ficam guardados aqui:
-- quem confere a conta contra a nota precisa saber que ela foi alterada, e
-- de quanto. Nulos = a conta nunca foi editada.

alter table public.contas_pagar add column if not exists valor_original numeric;
alter table public.contas_pagar add column if not exists vencimento_original date;
