-- Bucket privado das etiquetas de envio (PDFs com nome/endereço do
-- comprador). Sem regra de acesso para o navegador: o servidor guarda e
-- gera links curtos (service role). Execute no Supabase → SQL Editor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('etiquetas-envio', 'etiquetas-envio', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Número interno do pedido gerado só em inserção real (o default com
-- nextval queimava números a cada upsert do sync).
alter table marketplace_pedidos alter column numero_interno drop default;
create or replace function marketplace_pedidos_numerar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero_interno is null then
    update marketplace_pedidos set numero_interno = nextval('marketplace_pedidos_numero_interno_seq') where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_marketplace_pedidos_numerar on marketplace_pedidos;
create trigger trg_marketplace_pedidos_numerar after insert on marketplace_pedidos
  for each row execute function marketplace_pedidos_numerar();
