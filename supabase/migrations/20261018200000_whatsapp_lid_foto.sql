-- WhatsApp: o código oculto ("@lid") de cada pessoa e a foto do perfil.
--
-- O WhatsApp às vezes manda a mensagem com o número da pessoa e às vezes só
-- com um código ("76746787442896@lid") que não se converte em número. Cada
-- forma virava um contato: "Fatima Brandao" (21) 98217-1121 e
-- "76746787442896@lid" eram a mesma pessoa, com a conversa partida em duas
-- (medido em 18/10/2026: 24 de 126 contatos só com o código).
--
-- A Z-API manda o código em `chatLid` junto do número quando sabe os dois.
-- Aqui ele fica guardado no contato do número; mensagem que chega só com o
-- código cai nesse contato, e o contato antigo só do código é juntado nele.

ALTER TABLE whatsapp_contatos
  ADD COLUMN IF NOT EXISTS lid TEXT,
  ADD COLUMN IF NOT EXISTS foto_url TEXT,
  ADD COLUMN IF NOT EXISTS foto_em TIMESTAMPTZ;

-- Contato que já é só do código: o código é a própria chave ("x" + dígitos).
-- Telefone de verdade tem até 13 dígitos (a entrada recusa mais); o código, 14+.
UPDATE whatsapp_contatos SET lid = substr(chave, 2)
 WHERE lid IS NULL AND chave LIKE 'x%' AND length(substr(chave, 2)) >= 14;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contatos_empresa_lid
  ON whatsapp_contatos (empresa_id, lid) WHERE lid IS NOT NULL;

-- ── Juntar dois contatos da mesma pessoa ────────────────────────────────
-- Mensagens de `p_de` passam para `p_para`; o que um tem e o outro não, fica;
-- `p_de` é apagado. Chamado pelo registro (código descoberto) e pela tela.
CREATE OR REPLACE FUNCTION whatsapp_juntar_contatos(p_de UUID, p_para UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE d whatsapp_contatos; p whatsapp_contatos;
BEGIN
  IF p_de IS NULL OR p_para IS NULL OR p_de = p_para THEN RETURN p_para; END IF;
  SELECT * INTO d FROM whatsapp_contatos WHERE id = p_de FOR UPDATE;
  SELECT * INTO p FROM whatsapp_contatos WHERE id = p_para FOR UPDATE;
  IF d.id IS NULL OR p.id IS NULL OR d.empresa_id <> p.empresa_id THEN
    RAISE EXCEPTION 'Conversas não encontradas';
  END IF;
  -- Pela tela, só quem é da empresa. O webhook roda como serviço (sem usuário).
  IF auth.uid() IS NOT NULL AND NOT (empresa_do_meu_grupo(p.empresa_id) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- Os gatilhos das mensagens já atualizam entrada/saída e etapa do destino.
  UPDATE whatsapp_mensagens SET contato_id = p.id WHERE contato_id = d.id;
  SELECT * INTO p FROM whatsapp_contatos WHERE id = p_para;

  -- Apaga antes de passar o código adiante (o código é único por empresa).
  DELETE FROM whatsapp_contatos WHERE id = d.id;

  UPDATE whatsapp_contatos SET
    lid = coalesce(p.lid, d.lid),
    -- Nome de verdade ganha do código ("7674…@lid") e do vazio.
    nome_whatsapp = CASE
      WHEN coalesce(p.nome_whatsapp, '') = '' OR p.nome_whatsapp LIKE '%@lid'
        THEN coalesce(nullif(CASE WHEN d.nome_whatsapp LIKE '%@lid' THEN '' ELSE d.nome_whatsapp END, ''), p.nome_whatsapp)
      ELSE p.nome_whatsapp END,
    cliente_id = coalesce(p.cliente_id, d.cliente_id),
    status = CASE
      WHEN p.status = 'ignorado' THEN 'ignorado'
      WHEN coalesce(p.cliente_id, d.cliente_id) IS NOT NULL THEN 'cliente'
      ELSE p.status END,
    primeira_mensagem = CASE WHEN d.primeira_em < p.primeira_em
      THEN coalesce(d.primeira_mensagem, p.primeira_mensagem) ELSE coalesce(p.primeira_mensagem, d.primeira_mensagem) END,
    primeira_em = least(p.primeira_em, d.primeira_em),
    ultima_em = greatest(p.ultima_em, d.ultima_em),
    total_mensagens = coalesce(p.total_mensagens, 0) + coalesce(d.total_mensagens, 0),
    ultima_entrada_em = greatest(p.ultima_entrada_em, d.ultima_entrada_em),
    ultima_saida_em = greatest(p.ultima_saida_em, d.ultima_saida_em),
    lida_em = greatest(p.lida_em, d.lida_em),
    etapa = CASE WHEN p.etapa = 'novo' THEN d.etapa ELSE p.etapa END,
    retorno_em = coalesce(p.retorno_em, d.retorno_em),
    retorno_nota = coalesce(p.retorno_nota, d.retorno_nota),
    origem_codigo = coalesce(p.origem_codigo, d.origem_codigo),
    origem_em = CASE WHEN p.origem_codigo IS NULL THEN d.origem_em ELSE p.origem_em END,
    fora_horario_dia = greatest(p.fora_horario_dia, d.fora_horario_dia),
    foto_url = CASE WHEN d.foto_em > coalesce(p.foto_em, '-infinity') THEN d.foto_url ELSE coalesce(p.foto_url, d.foto_url) END,
    foto_em = greatest(p.foto_em, d.foto_em),
    updated_at = now()
  WHERE id = p.id;
  RETURN p.id;
END $$;

REVOKE ALL ON FUNCTION whatsapp_juntar_contatos(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_juntar_contatos(UUID, UUID) TO authenticated, service_role;

-- ── Código descoberto para um contato com número ────────────────────────
-- Guarda o código no contato e junta nele o contato que era só do código.
CREATE OR REPLACE FUNCTION whatsapp_ligar_lid(p_contato UUID, p_lid TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_lid TEXT := regexp_replace(coalesce(p_lid, ''), '\D', '', 'g'); v_emp UUID; v_chave TEXT; v_outro UUID;
BEGIN
  IF length(v_lid) < 8 OR p_contato IS NULL THEN RETURN; END IF;
  SELECT empresa_id, chave INTO v_emp, v_chave FROM whatsapp_contatos WHERE id = p_contato;
  -- Só contato com número de verdade recebe código de outro.
  IF v_emp IS NULL OR v_chave LIKE 'x%' THEN RETURN; END IF;
  SELECT id INTO v_outro FROM whatsapp_contatos
   WHERE empresa_id = v_emp AND id <> p_contato AND (lid = v_lid OR chave = 'x' || v_lid)
   ORDER BY (chave LIKE 'x%') DESC LIMIT 1;
  IF v_outro IS NOT NULL THEN
    -- O outro também tem número: não é a mesma conversa para juntar sozinho.
    IF NOT EXISTS (SELECT 1 FROM whatsapp_contatos WHERE id = v_outro AND chave LIKE 'x%') THEN RETURN; END IF;
    PERFORM whatsapp_juntar_contatos(v_outro, p_contato);
  END IF;
  UPDATE whatsapp_contatos SET lid = v_lid, updated_at = now() WHERE id = p_contato AND lid IS DISTINCT FROM v_lid;
END $$;

REVOKE ALL ON FUNCTION whatsapp_ligar_lid(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_ligar_lid(UUID, TEXT) TO service_role;

-- ── Registro do contato (webhook) com código e foto ─────────────────────
DROP FUNCTION IF EXISTS whatsapp_registrar_contato(UUID, TEXT, TEXT, TEXT);
CREATE FUNCTION whatsapp_registrar_contato(
  p_empresa UUID, p_telefone TEXT, p_nome TEXT, p_texto TEXT, p_lid TEXT DEFAULT NULL, p_foto TEXT DEFAULT NULL
)
RETURNS TABLE(contato_id UUID, cliente_id UUID, cliente_nome TEXT, interno BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dig TEXT := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_lid TEXT := nullif(regexp_replace(coalesce(p_lid, ''), '\D', '', 'g'), '');
  v_nome TEXT := nullif(left(trim(coalesce(p_nome, '')), 80), '');
  v_foto TEXT := CASE WHEN p_foto ~* '^https://' THEN left(p_foto, 1000) END;
  v_chave TEXT;
  v_cli_id UUID;
  v_id UUID;
  v_vinculado UUID;
BEGIN
  IF length(v_dig) < 8 THEN RETURN; END IF;
  IF length(coalesce(v_lid, '')) < 8 THEN v_lid := NULL; END IF;
  -- Código no lugar do nome não é nome.
  IF v_nome LIKE '%@lid' OR v_nome ~ '^[+\d\s()-]+$' THEN v_nome := NULL; END IF;
  v_chave := coalesce(tel_chave(v_dig), 'x' || v_dig);

  IF EXISTS (
    SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
    WHERE g.empresa_id = p_empresa AND tel_chave(d->>'numero') = v_chave
  ) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT, TRUE;
    RETURN;
  END IF;

  -- Só o código: se ele já está ligado a um contato (com número), é esse.
  IF v_chave LIKE 'x%' THEN
    v_lid := coalesce(v_lid, CASE WHEN length(v_dig) >= 14 THEN v_dig END);
    IF v_lid IS NOT NULL THEN
      UPDATE whatsapp_contatos w SET
        nome_whatsapp = coalesce(v_nome, w.nome_whatsapp),
        ultima_em = now(), total_mensagens = w.total_mensagens + 1,
        foto_url = coalesce(v_foto, w.foto_url), foto_em = CASE WHEN v_foto IS NOT NULL THEN now() ELSE w.foto_em END,
        updated_at = now()
      WHERE w.empresa_id = p_empresa AND w.lid = v_lid
      RETURNING w.id, w.cliente_id INTO v_id, v_vinculado;
      IF v_id IS NOT NULL THEN
        RETURN QUERY SELECT v_id, v_vinculado, (SELECT c.nome FROM clientes c WHERE c.id = v_vinculado), FALSE;
        RETURN;
      END IF;
    END IF;
  END IF;

  SELECT c.id INTO v_cli_id
  FROM clientes c
  WHERE c.empresa_id = p_empresa AND c.mesclado_em IS NULL
    AND (tel_chave(c.telefone) = v_chave OR tel_chave(c.whatsapp) = v_chave OR tel_chave(c.telefone_whatsapp) = v_chave)
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO whatsapp_contatos AS w (
    empresa_id, chave, telefone, nome_whatsapp, primeira_mensagem,
    primeira_em, ultima_em, total_mensagens, cliente_id, status, foto_url, foto_em,
    lid
  ) VALUES (
    p_empresa, v_chave, v_dig, v_nome, nullif(left(coalesce(p_texto, ''), 500), ''),
    now(), now(), 1, v_cli_id, CASE WHEN v_cli_id IS NULL THEN 'novo' ELSE 'cliente' END,
    v_foto, CASE WHEN v_foto IS NOT NULL THEN now() END,
    -- Contato só do código guarda o próprio código.
    CASE WHEN v_chave LIKE 'x%' THEN v_lid END
  )
  ON CONFLICT (empresa_id, chave) DO UPDATE SET
    telefone = excluded.telefone,
    nome_whatsapp = coalesce(excluded.nome_whatsapp, CASE WHEN w.nome_whatsapp LIKE '%@lid' THEN NULL ELSE w.nome_whatsapp END),
    primeira_mensagem = coalesce(w.primeira_mensagem, excluded.primeira_mensagem),
    ultima_em = now(),
    total_mensagens = w.total_mensagens + 1,
    cliente_id = coalesce(w.cliente_id, excluded.cliente_id),
    status = CASE
      WHEN w.status = 'ignorado' THEN 'ignorado'
      WHEN coalesce(w.cliente_id, excluded.cliente_id) IS NOT NULL THEN 'cliente'
      ELSE w.status
    END,
    foto_url = coalesce(excluded.foto_url, w.foto_url),
    foto_em = coalesce(excluded.foto_em, w.foto_em),
    updated_at = now()
  RETURNING w.id, w.cliente_id INTO v_id, v_vinculado;

  -- Número + código na mesma mensagem: liga os dois (e junta o contato do código).
  IF v_chave NOT LIKE 'x%' AND v_lid IS NOT NULL THEN
    PERFORM whatsapp_ligar_lid(v_id, v_lid);
    SELECT w.cliente_id INTO v_vinculado FROM whatsapp_contatos w WHERE w.id = v_id;
  END IF;

  RETURN QUERY SELECT v_id, v_vinculado, (SELECT c.nome FROM clientes c WHERE c.id = v_vinculado), FALSE;
END $$;

REVOKE ALL ON FUNCTION whatsapp_registrar_contato(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_registrar_contato(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── Mensagem gravada só com o código cai no contato que o tem ───────────
CREATE OR REPLACE FUNCTION whatsapp_mensagem_ligar_contato()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_dig TEXT;
BEGIN
  IF NEW.contato_id IS NULL AND NEW.telefone IS NOT NULL THEN
    v_dig := regexp_replace(NEW.telefone, '\D', '', 'g');
    SELECT w.id INTO NEW.contato_id
    FROM whatsapp_contatos w
    WHERE w.empresa_id = NEW.empresa_id
      AND (w.chave = coalesce(tel_chave(NEW.telefone), 'x' || v_dig)
           OR (length(v_dig) >= 14 AND w.lid = v_dig))
    ORDER BY (w.chave = coalesce(tel_chave(NEW.telefone), 'x' || v_dig)) DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

-- ── A lista de conversas mostra a foto ──────────────────────────────────
CREATE OR REPLACE VIEW whatsapp_conversas WITH (security_invoker = true) AS
 SELECT w.id,
    w.empresa_id,
    w.telefone,
    w.chave,
    w.nome_whatsapp,
    w.status,
    w.cliente_id,
    c.nome AS cliente_nome,
    w.total_mensagens,
    w.primeira_em,
    w.ultima_entrada_em,
    w.ultima_saida_em,
    w.lida_em,
    GREATEST(w.ultima_entrada_em, w.ultima_saida_em) AS ultima_atividade,
    w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > COALESCE(w.ultima_saida_em, '-infinity'::timestamp with time zone) AS aguardando,
    w.ultima_entrada_em IS NOT NULL AND w.ultima_entrada_em > COALESCE(w.lida_em, '-infinity'::timestamp with time zone) AS nao_lida,
    w.etapa,
    w.etapa_em,
    w.retorno_em,
    w.retorno_nota,
    w.retorno_em IS NOT NULL AND w.retorno_em <= (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS retorno_vencido,
    w.etapa = 'orcamento'::text AND w.etapa_em < (now() - '3 days'::interval) AND COALESCE(w.ultima_entrada_em, '-infinity'::timestamp with time zone) < w.etapa_em AS orcamento_parado,
    w.origem_codigo,
    w.origem_em,
    w.foto_url,
    w.foto_em,
    w.lid
   FROM whatsapp_contatos w
     LEFT JOIN clientes c ON c.id = w.cliente_id;
