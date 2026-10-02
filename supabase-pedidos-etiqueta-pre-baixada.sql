-- Etiqueta pré-baixada pelo robô /api/cron/etiquetas.
alter table marketplace_pedidos
  add column if not exists etiqueta_arquivo text,
  add column if not exists etiqueta_baixada_em timestamptz,
  add column if not exists etiqueta_erro text,
  add column if not exists etiqueta_tentativa_em timestamptz;
