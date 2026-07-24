-- ============================================================
-- Habilita RLS em contas_pagar, nfe_entradas, nfe_itens e fornecedores.
--
-- Por quê: hoje essas 4 tabelas estão com RLS desabilitado — o
-- isolamento entre empresas existe só porque o código sempre filtra
-- por empresa_id nas queries. Isso é seguro enquanto só o próprio
-- dono usa o sistema com a chave anon, mas deixa de ser seguro assim
-- que um cliente externo pagante (plano "Consulta Fiscal") ganha
-- login próprio: qualquer bug ou requisição manual poderia ler dados
-- de outra empresa.
--
-- A policy abaixo replica exatamente o filtro que o código já faz
-- hoje (empresa_id do usuário logado, via profiles), no mesmo padrão
-- já usado em subscriptions/tenant_usage (ver supabase-saas-plans.sql,
-- função is_system_admin() já existe). Não deveria mudar nenhum
-- comportamento pra quem já usa o sistema hoje — só bloqueia acesso
-- cross-empresa que a UI nunca fez de propósito. Confirmado direto no
-- banco que as 4 tabelas têm empresa_id (inclusive nfe_itens).
--
-- Rode como usuário dono/admin depois: abra Contas a Pagar, Entrada
-- por XML e Fornecedores e confirme que continuam funcionando normal.
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

alter table contas_pagar enable row level security;
alter table nfe_entradas enable row level security;
alter table nfe_itens    enable row level security;
alter table fornecedores enable row level security;

create policy "contas_pagar_empresa" on contas_pagar for all
  using (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin())
  with check (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin());

create policy "nfe_entradas_empresa" on nfe_entradas for all
  using (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin())
  with check (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin());

create policy "fornecedores_empresa" on fornecedores for all
  using (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin())
  with check (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin());

create policy "nfe_itens_empresa" on nfe_itens for all
  using (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin())
  with check (empresa_id in (select empresa_id from profiles where id = auth.uid()) or is_system_admin());
