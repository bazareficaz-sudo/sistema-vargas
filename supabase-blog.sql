-- Blog de novidades e atualizações do Sistema Vargas
-- Canal de comunicação com os clientes: lançamentos, atualizações, manutenções e dicas.
-- Requer que supabase-saas-plans.sql já tenha sido executado (usa system_admins / is_system_admin()).

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text not null unique,
  resumo text default '',
  conteudo text not null default '',
  capa_url text,
  categoria text not null default 'novidade', -- novidade | atualizacao | manutencao | dica
  publicado boolean not null default false,
  destaque boolean not null default false,
  autor text default 'Equipe Vargas',
  autor_id uuid references system_admins(id) on delete set null,
  publicado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blog_posts_publicado_idx on blog_posts (publicado, publicado_em desc);
create index if not exists blog_posts_categoria_idx on blog_posts (categoria);

alter table blog_posts enable row level security;

-- Leitura pública apenas de posts publicados (site institucional e dashboard dos clientes)
create policy "blog_posts_public_read" on blog_posts for select using (publicado = true);

-- Administradores do SaaS têm acesso total (rascunhos, edição, exclusão)
create policy "blog_posts_admin_all" on blog_posts for all using (is_system_admin());
