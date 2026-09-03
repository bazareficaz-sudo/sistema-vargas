-- POR QUE O ANUNCIO ESTA PAUSADO. Aplicada em producao em 03/09/2026.
--
-- Ate aqui o sistema so sabia QUE estava: `status = 'pausado'`, sem dizer
-- quem pausou. Isso tornava impossivel religar sozinho o que a falta de
-- estoque desligou sem tambem religar o que a pessoa desligou de proposito.
--
--   automatica  a regra pausou por estoque. O sistema PODE religar sozinho.
--   manual      uma pessoa pausou. So outra acao humana reativa.
--   NULL        nao esta pausado, ou e anterior a esta coluna.
alter table marketplace_anuncios
  add column if not exists pausa_origem text,
  add column if not exists pausa_em timestamptz,
  add column if not exists pausa_por uuid,
  add column if not exists pausa_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketplace_anuncios_pausa_origem_valida') then
    alter table marketplace_anuncios add constraint marketplace_anuncios_pausa_origem_valida
      check (pausa_origem is null or pausa_origem in ('automatica', 'manual'));
  end if;
end $$;

create index if not exists idx_anuncios_pausa_origem
  on marketplace_anuncios(canal_id, pausa_origem)
  where pausa_origem is not null;

-- OS PAUSADOS QUE JA EXISTEM FICAM COM `pausa_origem` NULA, de proposito.
-- Marcar como 'automatica' faria o sistema religar, na primeira reposicao,
-- anuncios que alguem tirou do ar meses atras. Nulo significa "nao sei", e o
-- codigo trata nao sei como manual.
comment on column marketplace_anuncios.pausa_origem is
  'automatica = a regra pausou por estoque (pode religar sozinho); manual = pessoa pausou (so acao humana reativa); NULL = desconhecido, tratado como manual.';
comment on column marketplace_anuncios.pausa_motivo is
  'Frase do motivo da pausa automatica, para a tela explicar em vez de so dizer "pausado".';
