-- Preço por variação na precificação (TikTok): o histórico diz qual variação
-- recebeu o preço. Nulo = preço do anúncio, como sempre foi.
alter table public.precificacao_historico
  add column if not exists variacao_id uuid references public.marketplace_anuncio_variacoes(id) on delete set null;
create index if not exists precificacao_historico_variacao_idx on public.precificacao_historico (variacao_id) where variacao_id is not null;
