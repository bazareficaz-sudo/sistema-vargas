-- Tags livres em produtos, para listagens personalizadas (ex: "online") que o
-- usuário filtra tanto na tela de Produtos quanto na de Anúncios do marketplace.
alter table produtos add column if not exists tags text[] not null default '{}';

create index if not exists idx_produtos_tags on produtos using gin (tags);
