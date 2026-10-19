-- FOTO DO CLIENTE no cadastro: enviada pela tela ou copiada da foto do perfil
-- do WhatsApp (o link do WhatsApp vence; por isso a imagem é copiada).
--
-- 1. clientes: foto_path (arquivo no bucket), foto_origem (whatsapp/manual)
--    e foto_em. O caminho precisa ser <empresa>/<cliente>/… do próprio
--    cliente.
-- 2. Bucket PRIVADO clientes-fotos (até 5 MB, só imagem). O logado lê, envia
--    e apaga só na pasta da própria empresa (mesma regra das mídias do
--    WhatsApp); a tela mostra com link assinado.
--
-- Aditiva e idempotente.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto_path TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto_origem TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto_em TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_foto_origem_check') THEN
    ALTER TABLE clientes ADD CONSTRAINT clientes_foto_origem_check
      CHECK (foto_origem IS NULL OR foto_origem IN ('whatsapp', 'manual')) NOT VALID;
    ALTER TABLE clientes VALIDATE CONSTRAINT clientes_foto_origem_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_foto_path_check') THEN
    ALTER TABLE clientes ADD CONSTRAINT clientes_foto_path_check
      CHECK (foto_path IS NULL OR foto_path LIKE empresa_id::text || '/' || id::text || '/%') NOT VALID;
    ALTER TABLE clientes VALIDATE CONSTRAINT clientes_foto_path_check;
  END IF;
END $$;

COMMENT ON COLUMN clientes.foto_path IS 'Foto do cliente no bucket clientes-fotos (<empresa>/<cliente>/<arquivo>).';
COMMENT ON COLUMN clientes.foto_origem IS 'whatsapp = copiada da foto do perfil; manual = enviada pela tela.';

-- O logado já atualiza o cadastro por colunas: as novas entram na lista.
GRANT SELECT (foto_path, foto_origem, foto_em) ON clientes TO authenticated;
GRANT UPDATE (foto_path, foto_origem, foto_em) ON clientes TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clientes-fotos', 'clientes-fotos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Pasta da empresa: reaproveita a regra das mídias do WhatsApp
-- (whatsapp_midia_da_minha_empresa, 20261016200000_whatsapp_midias.sql).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'clientes_fotos_ler') THEN
    CREATE POLICY clientes_fotos_ler ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'clientes-fotos' AND whatsapp_midia_da_minha_empresa(name));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'clientes_fotos_enviar') THEN
    CREATE POLICY clientes_fotos_enviar ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'clientes-fotos' AND whatsapp_midia_da_minha_empresa(name));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'clientes_fotos_apagar') THEN
    CREATE POLICY clientes_fotos_apagar ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'clientes-fotos' AND whatsapp_midia_da_minha_empresa(name));
  END IF;
END $$;
