-- AGENTE GETÚLIO — Fase 2 (aplicado em 08/10/2026).
-- Alertas imediatos e resumo semanal (ligados por padrão) e o instante em que
-- cada sinal virou novidade — é o que decide o alerta imediato.
ALTER TABLE public.getulio_config
  ADD COLUMN IF NOT EXISTS alertas_imediatos boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS resumo_semanal boolean NOT NULL DEFAULT true;
ALTER TABLE public.getulio_sinais ADD COLUMN IF NOT EXISTS novidade_em timestamptz NOT NULL DEFAULT now();
UPDATE public.getulio_sinais SET novidade_em = detectado_em WHERE novidade_em > detectado_em;
