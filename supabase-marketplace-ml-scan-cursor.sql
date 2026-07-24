-- Cursor de paginação "scan" (scroll_id) do catálogo do Mercado Livre.
-- Sem isso, cada sincronização de catálogo recomeçava do zero (offset 0) e
-- nunca avançava além do teto de itens por rodada — confirmado ao vivo numa
-- conta real com 5.449 anúncios: só os primeiros ~500 (sempre os mesmos)
-- eram sincronizados, não importa quantas vezes "Sincronizar agora" fosse
-- clicado.
alter table marketplace_canais add column if not exists ml_scan_scroll_id text;
