-- Contas a pagar de várias empresas numa tela só.
--
-- contas_pagar, fornecedores e nfe_entradas liberavam só a empresa do
-- CADASTRO (profiles.empresa_id). Quem tem vínculo com mais de uma empresa
-- (usuario_empresas) não enxergava as contas da outra — e, ao trocar de
-- empresa no seletor, também não. Passam a seguir empresa_do_meu_grupo(),
-- a mesma regra de empresas e entradas: a empresa do cadastro OU uma
-- empresa com vínculo ativo.
--
-- tipos_despesa estava SEM RLS: qualquer usuário logado lia e alterava os
-- tipos de qualquer empresa. Ganha a mesma regra.

drop policy if exists contas_pagar_empresa on public.contas_pagar;
create policy contas_pagar_empresa on public.contas_pagar for all
  using (empresa_do_meu_grupo(empresa_id) or is_system_admin())
  with check (empresa_do_meu_grupo(empresa_id) or is_system_admin());

drop policy if exists fornecedores_empresa on public.fornecedores;
create policy fornecedores_empresa on public.fornecedores for all
  using (empresa_do_meu_grupo(empresa_id) or is_system_admin())
  with check (empresa_do_meu_grupo(empresa_id) or is_system_admin());

drop policy if exists nfe_entradas_empresa on public.nfe_entradas;
create policy nfe_entradas_empresa on public.nfe_entradas for all
  using (empresa_do_meu_grupo(empresa_id) or is_system_admin())
  with check (empresa_do_meu_grupo(empresa_id) or is_system_admin());

alter table public.tipos_despesa enable row level security;
drop policy if exists tipos_despesa_empresa on public.tipos_despesa;
create policy tipos_despesa_empresa on public.tipos_despesa for all
  using (empresa_do_meu_grupo(empresa_id) or is_system_admin())
  with check (empresa_do_meu_grupo(empresa_id) or is_system_admin());
