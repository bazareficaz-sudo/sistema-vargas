-- Bloqueia o duplo-lançamento da mesma venda pelo PDV externo.
--
-- Diagnóstico: 17 vendas nasceram duplicadas porque o PDV externo enviou o
-- mesmo lançamento duas vezes, com 7 a 678 ms de diferença — mesmo número,
-- mesmo total, mesmos itens. Como o PDV externo grava direto no banco, a
-- proteção precisa morar aqui: regra que mora na tela não alcança quem entra
-- por outra porta.
--
-- Índice único em (empresa_id, numero) NÃO serve: a numeração é reaproveitada
-- de propósito (#100001 apareceu de novo 25 dias depois, #301743 14 h depois).
-- O que caracteriza o erro é a repetição *imediata*, então a janela de tempo
-- é o critério.

create table if not exists vendas_duplicidade_bloqueada (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  numero bigint,
  total numeric,
  venda_original_id uuid,
  terminal_id text,
  operador_nome text,
  bloqueado_em timestamptz not null default now()
);

create index if not exists idx_vendas_dup_bloq_empresa
  on vendas_duplicidade_bloqueada (empresa_id, bloqueado_em desc);

create or replace function bloquear_venda_duplicada()
returns trigger
language plpgsql
as $$
declare
  v_original uuid;
begin
  if new.numero is null then
    return new;
  end if;

  -- Mesma empresa, mesmo número e mesmo total nos últimos 2 minutos.
  -- A reutilização legítima de numeração acontece com horas ou dias de
  -- intervalo, então a janela curta não a atinge.
  select id into v_original
    from vendas
   where empresa_id = new.empresa_id
     and numero     = new.numero
     and total is not distinct from new.total
     and created_at > now() - interval '2 minutes'
   order by created_at
   limit 1;

  if v_original is null then
    return new;
  end if;

  insert into vendas_duplicidade_bloqueada
    (empresa_id, numero, total, venda_original_id, terminal_id, operador_nome)
  values
    (new.empresa_id, new.numero, new.total, v_original, new.terminal_id, new.operador_nome);

  -- Descarta a segunda gravação em silêncio. Devolver erro faria o operador
  -- ver "falhou" numa venda que na verdade passou, e ele lançaria de novo —
  -- trocaria um duplicado por dois.
  return null;
end;
$$;

drop trigger if exists trg_bloquear_venda_duplicada on vendas;

create trigger trg_bloquear_venda_duplicada
  before insert on vendas
  for each row
  execute function bloquear_venda_duplicada();
