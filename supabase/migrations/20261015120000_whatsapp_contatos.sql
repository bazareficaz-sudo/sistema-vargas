-- CONTATOS DO WHATSAPP: quem manda mensagem para a loja vira pré-cadastro.
--
-- Medido em 15/10/2026: desde que o webhook voltou a gravar (08/10), 100
-- números diferentes mandaram mensagem e só 4 eram clientes cadastrados.
-- Os outros 96 ficavam só como linhas soltas em whatsapp_mensagens.
--
-- 1. tel_chave(): a mesma pessoa chega com e sem o 55, com e sem o 9 extra.
--    A chave é DDD + os 8 últimos dígitos (mesma regra de
--    lib/getulio/numero.ts e de lib/whatsapp/contatos.ts).
-- 2. whatsapp_contatos: um por número e empresa, com o nome que aparece no
--    WhatsApp, a primeira mensagem, quantas mensagens e o cliente quando o
--    número já é de um cadastro. NÃO é cadastro de cliente: o balconista
--    cadastra quando fizer sentido (tela Contatos do WhatsApp).
-- 3. Gatilho em clientes: cadastrou ou trocou o telefone → o contato com o
--    mesmo número passa a apontar para o cliente, e as mensagens recebidas
--    dele também. Cliente unificado em outro → o contato segue o destino.
-- 4. Só o webhook (chave de serviço) grava contato, pela função
--    whatsapp_registrar_contato. Número dos destinatários do Getúlio (dono,
--    gerente) não vira contato.
-- 5. Acesso: anon nenhum; logado vê os da empresa e só muda o status
--    (novo / cliente / ignorado).
--
-- LGPD: guardar o contato serve para responder quem procurou a loja. Isto
-- não é autorização para mandar promoção.

-- ── 1. Chave do telefone ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tel_chave(t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN length(d) IN (10, 11) THEN substr(d, 1, 2) || right(d, 8) END
  FROM (
    SELECT CASE
      WHEN length(x) > 11 AND x LIKE '55%' THEN substr(x, 3)
      WHEN length(x) IN (11, 12) AND x LIKE '0%' THEN substr(x, 2)
      ELSE x
    END AS d
    FROM (SELECT regexp_replace(coalesce(t, ''), '\D', '', 'g') AS x) a
  ) b
$$;

COMMENT ON FUNCTION tel_chave(TEXT) IS
  'DDD + 8 últimos dígitos (sem 55, sem 0 de discagem, sem o 9 extra). Nulo se não tiver DDD.';

CREATE INDEX IF NOT EXISTS idx_clientes_tel_chave_telefone
  ON clientes (empresa_id, tel_chave(telefone)) WHERE mesclado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_tel_chave_whatsapp
  ON clientes (empresa_id, tel_chave(whatsapp)) WHERE mesclado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_tel_chave_telefone_whatsapp
  ON clientes (empresa_id, tel_chave(telefone_whatsapp)) WHERE mesclado_em IS NULL;

-- ── 2. Contatos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_contatos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  -- tel_chave(telefone); sem DDD reconhecível, 'x' + os dígitos.
  chave             TEXT NOT NULL,
  telefone          TEXT NOT NULL,
  nome_whatsapp     TEXT CHECK (char_length(nome_whatsapp) <= 80),
  cliente_id        UUID REFERENCES clientes(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'cliente', 'ignorado')),
  primeira_mensagem TEXT CHECK (char_length(primeira_mensagem) <= 500),
  primeira_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_mensagens   INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, chave)
);

COMMENT ON TABLE whatsapp_contatos IS
  'Quem mandou mensagem para a loja pelo WhatsApp (pré-cadastro). Gravado só pelo webhook. Não autoriza envio de promoção.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_contatos_lista
  ON whatsapp_contatos (empresa_id, status, ultima_em DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contatos_cliente
  ON whatsapp_contatos (cliente_id) WHERE cliente_id IS NOT NULL;

ALTER TABLE whatsapp_mensagens ADD COLUMN IF NOT EXISTS contato_id UUID REFERENCES whatsapp_contatos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_contato
  ON whatsapp_mensagens (contato_id) WHERE contato_id IS NOT NULL;

ALTER TABLE whatsapp_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_contatos_ler ON whatsapp_contatos;
CREATE POLICY whatsapp_contatos_ler ON whatsapp_contatos
  FOR SELECT USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS whatsapp_contatos_status ON whatsapp_contatos;
CREATE POLICY whatsapp_contatos_status ON whatsapp_contatos
  FOR UPDATE USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- Logado: lê e muda só o status. Inserir, apagar e vincular cliente é do
-- sistema (webhook e gatilho).
REVOKE ALL ON whatsapp_contatos FROM anon, authenticated;
GRANT SELECT ON whatsapp_contatos TO authenticated;
GRANT UPDATE (status, updated_at) ON whatsapp_contatos TO authenticated;

-- ── 3. Registro pelo webhook ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION whatsapp_registrar_contato(
  p_empresa UUID, p_telefone TEXT, p_nome TEXT, p_texto TEXT
)
RETURNS TABLE (contato_id UUID, cliente_id UUID, cliente_nome TEXT, interno BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dig TEXT := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_chave TEXT;
  v_cli_id UUID;
  v_id UUID;
  v_vinculado UUID;
BEGIN
  IF length(v_dig) < 8 THEN RETURN; END IF;
  v_chave := coalesce(tel_chave(v_dig), 'x' || v_dig);

  -- Dono e equipe (destinatários do Getúlio) não são lead.
  IF EXISTS (
    SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
    WHERE g.empresa_id = p_empresa AND tel_chave(d->>'numero') = v_chave
  ) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT, TRUE;
    RETURN;
  END IF;

  SELECT c.id INTO v_cli_id
  FROM clientes c
  WHERE c.empresa_id = p_empresa AND c.mesclado_em IS NULL
    AND (tel_chave(c.telefone) = v_chave OR tel_chave(c.whatsapp) = v_chave OR tel_chave(c.telefone_whatsapp) = v_chave)
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO whatsapp_contatos AS w (
    empresa_id, chave, telefone, nome_whatsapp, primeira_mensagem,
    primeira_em, ultima_em, total_mensagens, cliente_id, status
  ) VALUES (
    p_empresa, v_chave, v_dig, nullif(left(trim(coalesce(p_nome, '')), 80), ''), nullif(left(coalesce(p_texto, ''), 500), ''),
    now(), now(), 1, v_cli_id, CASE WHEN v_cli_id IS NULL THEN 'novo' ELSE 'cliente' END
  )
  ON CONFLICT (empresa_id, chave) DO UPDATE SET
    telefone = excluded.telefone,
    nome_whatsapp = coalesce(excluded.nome_whatsapp, w.nome_whatsapp),
    primeira_mensagem = coalesce(w.primeira_mensagem, excluded.primeira_mensagem),
    ultima_em = now(),
    total_mensagens = w.total_mensagens + 1,
    cliente_id = coalesce(w.cliente_id, excluded.cliente_id),
    status = CASE
      WHEN w.status = 'ignorado' THEN 'ignorado'
      WHEN coalesce(w.cliente_id, excluded.cliente_id) IS NOT NULL THEN 'cliente'
      ELSE w.status
    END,
    updated_at = now()
  RETURNING w.id, w.cliente_id INTO v_id, v_vinculado;

  RETURN QUERY SELECT v_id, v_vinculado, (SELECT c.nome FROM clientes c WHERE c.id = v_vinculado), FALSE;
END $$;

REVOKE ALL ON FUNCTION whatsapp_registrar_contato(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_registrar_contato(UUID, TEXT, TEXT, TEXT) TO service_role;

-- ── 4. Cliente cadastrado ou unificado → contato acompanha ─────────────
CREATE OR REPLACE FUNCTION whatsapp_contatos_vincular_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Unificado em outro cadastro: contato e mensagens seguem o destino.
  IF NEW.mesclado_em IS NOT NULL THEN
    UPDATE whatsapp_contatos SET cliente_id = NEW.mesclado_em, updated_at = now()
     WHERE cliente_id = NEW.id;
    RETURN NEW;
  END IF;

  WITH ligados AS (
    UPDATE whatsapp_contatos w
       SET cliente_id = NEW.id,
           status = CASE WHEN w.status = 'ignorado' THEN 'ignorado' ELSE 'cliente' END,
           updated_at = now()
     WHERE w.empresa_id = NEW.empresa_id
       AND w.cliente_id IS NULL
       AND w.chave IN (tel_chave(NEW.telefone), tel_chave(NEW.whatsapp), tel_chave(NEW.telefone_whatsapp))
    RETURNING w.id
  )
  UPDATE whatsapp_mensagens m
     SET cliente_id = NEW.id, cliente_nome = NEW.nome, updated_at = now()
   WHERE m.contato_id IN (SELECT id FROM ligados) AND m.cliente_id IS NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_contatos_vincular_cliente ON clientes;
CREATE TRIGGER trg_whatsapp_contatos_vincular_cliente
  AFTER INSERT OR UPDATE OF telefone, whatsapp, telefone_whatsapp, mesclado_em ON clientes
  FOR EACH ROW EXECUTE FUNCTION whatsapp_contatos_vincular_cliente();

-- ── 5. Histórico: quem já mandou mensagem desde 08/10 ──────────────────
INSERT INTO whatsapp_contatos (empresa_id, chave, telefone, primeira_mensagem, primeira_em, ultima_em, total_mensagens)
SELECT m.empresa_id, m.chave,
       (array_agg(m.dig ORDER BY m.quando DESC))[1],
       (array_agg(left(m.conteudo, 500) ORDER BY m.quando))[1],
       min(m.quando), max(m.quando), count(*)
FROM (
  SELECT empresa_id, conteudo,
         coalesce(enviado_em, created_at, now()) AS quando,
         regexp_replace(telefone, '\D', '', 'g') AS dig,
         coalesce(tel_chave(telefone), 'x' || regexp_replace(telefone, '\D', '', 'g')) AS chave
  FROM whatsapp_mensagens
  WHERE tipo = 'recebida' AND length(regexp_replace(telefone, '\D', '', 'g')) >= 8
) m
WHERE NOT EXISTS (
  SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
  WHERE g.empresa_id = m.empresa_id AND tel_chave(d->>'numero') = m.chave
)
GROUP BY m.empresa_id, m.chave
ON CONFLICT (empresa_id, chave) DO NOTHING;

UPDATE whatsapp_contatos w
   SET cliente_id = (
     SELECT c.id FROM clientes c
     WHERE c.empresa_id = w.empresa_id AND c.mesclado_em IS NULL
       AND w.chave IN (tel_chave(c.telefone), tel_chave(c.whatsapp), tel_chave(c.telefone_whatsapp))
     ORDER BY c.updated_at DESC NULLS LAST LIMIT 1
   )
 WHERE w.cliente_id IS NULL;

UPDATE whatsapp_contatos SET status = 'cliente' WHERE cliente_id IS NOT NULL AND status = 'novo';

UPDATE whatsapp_mensagens m
   SET contato_id = w.id
  FROM whatsapp_contatos w
 WHERE m.tipo = 'recebida' AND m.contato_id IS NULL
   AND w.empresa_id = m.empresa_id
   AND w.chave = coalesce(tel_chave(m.telefone), 'x' || regexp_replace(m.telefone, '\D', '', 'g'));
