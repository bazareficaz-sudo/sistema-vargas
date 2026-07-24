-- Incentivos, Saúde da Venda e Automações nunca tiveram um `modulo` próprio
-- no menu — apareciam pra qualquer plano, inclusive o Fiscal (que não deveria
-- ter acesso comercial nenhum). Agora que ganharam gate, backfilla esses 3
-- módulos em todos os planos que já tinham vendas/pdv (ou seja, todo mundo
-- exceto o Fiscal), pra ninguém perder acesso que já tinha.
insert into plan_modules (plan_id, modulo)
select p.id, m.modulo
from plans p
cross join (values ('incentivos'), ('saude_venda'), ('automacoes')) as m(modulo)
where p.codigo <> '005'  -- Fiscal
  and not exists (
    select 1 from plan_modules pm where pm.plan_id = p.id and pm.modulo = m.modulo
  );
