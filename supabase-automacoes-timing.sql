-- ============================================================
-- Automações: ritmo de execução (timing) + aviso de falha por WhatsApp.
--
-- `timing` controla quando uma regra "por evento" (hoje só as de emissão
-- fiscal) é elegível a rodar no cron de 5 em 5 min:
--   imediato            — toda passada do cron (comportamento de hoje)
--   hora_em_hora        — só se `ultima_execucao` tiver mais de 1h
--   horario_especifico  — 1x/dia, no horário de `horario_envio` (reaproveita
--                          a mesma coluna/dedup já usado pelos tipos
--                          TIPOS_AGENDADOS_1X_DIA, via `ultima_execucao_dia`)
--
-- `alertar_erro_whatsapp` é opcional: quando preenchido, o executor manda
-- um aviso pro número quando a regra terminar com status 'erro' (throttle
-- de 1h por regra, pra não repetir o mesmo aviso a cada 5 minutos enquanto
-- o problema persistir — ver src/lib/automacoes/alertaFalha.ts).
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE automacoes ADD COLUMN IF NOT EXISTS timing TEXT NOT NULL DEFAULT 'imediato';
ALTER TABLE automacoes ADD COLUMN IF NOT EXISTS alertar_erro_whatsapp TEXT;
