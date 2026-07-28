-- Corrige colunas de NFC-e ausentes em `vendas`, que deveriam ter sido
-- criadas por supabase-migracao-pdv.sql mas nunca foram aplicadas em
-- produção. emitirNfceParaVenda() (src/lib/fiscal/emitirParaVenda.ts) já
-- grava nesses campos há tempos — sem eles, número/chave/DANFE de toda
-- NFC-e emitida vinham sendo perdidos silenciosamente.
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS nfce_emitida BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nfce_chave   TEXT,
  ADD COLUMN IF NOT EXISTS nfce_numero  TEXT,
  ADD COLUMN IF NOT EXISTS nfce_serie   TEXT,
  ADD COLUMN IF NOT EXISTS nfce_url_pdf TEXT;
