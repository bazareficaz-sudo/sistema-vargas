-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — o erro que impedia trazer as campanhas da Shopee.
-- Aplicada em producao em 03/09/2026.
--
-- Reportado da tela: a API respondeu certo ("2 campanha(s) lidos") e a
-- gravacao falhou nas duas.
--
-- A CAUSA. O indice unico era PARCIAL:
--
--   CREATE UNIQUE INDEX marketplace_promocoes_canal_externo
--     ON marketplace_promocoes (canal_id, id_externo)
--     WHERE (id_externo IS NOT NULL);
--
-- O Postgres so aceita `ON CONFLICT (canal_id, id_externo)` quando existe um
-- indice unico SEM filtro sobre exatamente essas colunas — ou quando a
-- instrucao repete o mesmo predicado. O cliente do Supabase manda so as
-- colunas, entao nunca casava.
--
-- POR QUE TROCAR O INDICE E NAO O CODIGO. A alternativa seria o codigo
-- procurar a linha antes e decidir entre insert e update: duas viagens ao
-- banco e uma janela de corrida entre elas. O indice resolve no lugar certo.
--
-- O FILTRO NAO FAZIA FALTA: `id_externo` e obrigatorio para toda campanha
-- vinda de marketplace, e a tabela estava vazia (conferido: 0 linhas). Por
-- isso a coluna passa a ser NOT NULL e o indice deixa de ser parcial.
alter table marketplace_promocoes
  alter column id_externo set not null;

drop index if exists marketplace_promocoes_canal_externo;

create unique index if not exists marketplace_promocoes_canal_externo
  on marketplace_promocoes (canal_id, id_externo);
