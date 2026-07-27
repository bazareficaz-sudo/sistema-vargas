-- ============================================================
-- PDV_IMPRESSAO — publica a URL do tunnel do terminal-caixa
-- Execute no Supabase Dashboard → SQL Editor
--
-- O terminal-caixa (com a impressora física) roda um Cloudflare
-- Quick Tunnel que gera uma URL pública nova a cada reinício. Em vez
-- de reconfigurar essa URL manualmente nos outros terminais, o caixa
-- publica a URL atual aqui, e os demais terminais consultam a cada
-- sincronização (a cada ~2min) e se auto-configuram.
-- ============================================================

CREATE TABLE IF NOT EXISTS pdv_impressao (
  empresa_id        UUID PRIMARY KEY,
  print_server_url  TEXT NOT NULL,
  terminal_id       TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pdv_impressao DISABLE ROW LEVEL SECURITY;
