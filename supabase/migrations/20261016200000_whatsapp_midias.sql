-- ARQUIVOS DAS CONVERSAS DO WHATSAPP (foto, áudio, vídeo, documento).
--
-- O link que a Z-API manda no webhook é temporário: o arquivo é copiado para
-- este bucket PRIVADO (src/lib/whatsapp/midias.ts). A imagem colada na
-- conversa (Ctrl+V) também sobe para cá antes de ir pela Z-API.
--
-- Caminho: <empresa_id>/<contato_id>/<arquivo>. O logado lê e envia só na
-- pasta da própria empresa (mesma regra do RLS das tabelas); não apaga nem
-- altera. A tela mostra com link assinado de 1 h — nada é público.
--
-- Aditiva e idempotente.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp-midias', 'whatsapp-midias', false, 16777216)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION whatsapp_midia_da_minha_empresa(p_nome TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE v_pasta TEXT := split_part(p_nome, '/', 1);
BEGIN
  IF v_pasta !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN empresa_do_meu_grupo(v_pasta::uuid) OR is_system_admin();
END $$;

REVOKE ALL ON FUNCTION whatsapp_midia_da_minha_empresa(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_midia_da_minha_empresa(TEXT) TO authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'whatsapp_midias_ler') THEN
    CREATE POLICY whatsapp_midias_ler ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'whatsapp-midias' AND whatsapp_midia_da_minha_empresa(name));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'whatsapp_midias_enviar') THEN
    CREATE POLICY whatsapp_midias_enviar ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'whatsapp-midias' AND whatsapp_midia_da_minha_empresa(name));
  END IF;
END $$;
