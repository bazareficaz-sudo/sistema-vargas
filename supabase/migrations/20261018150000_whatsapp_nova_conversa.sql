-- NOVA CONVERSA pela caixa de entrada: a loja começa a conversa com um
-- cliente do cadastro ou com um número digitado (antes, só quem escrevia
-- primeiro virava conversa).
--
-- whatsapp_abrir_conversa(empresa, telefone): devolve o contato desse número,
-- criando se não existir — sem contar como mensagem recebida (total 0, sem
-- primeira_mensagem). Liga ao cadastro do cliente pelo telefone, como o
-- webhook. Recusa número inválido e número da equipe (destinatários do
-- Getúlio). Só para quem é da empresa (mesma regra do RLS). Nada é enviado.
--
-- Depende de 20261015120000_whatsapp_contatos.sql. Aditiva e idempotente.

CREATE OR REPLACE FUNCTION whatsapp_abrir_conversa(p_empresa UUID, p_telefone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dig TEXT := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_chave TEXT;
  v_cli UUID;
  v_id UUID;
BEGIN
  IF NOT (empresa_do_meu_grupo(p_empresa) OR is_system_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF length(v_dig) IN (10, 11) THEN v_dig := '55' || v_dig; END IF;
  v_chave := tel_chave(v_dig);
  IF v_chave IS NULL OR length(v_dig) NOT IN (12, 13) OR left(v_dig, 2) <> '55' THEN
    RAISE EXCEPTION 'Número inválido: informe o DDD e o número.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM getulio_config g, jsonb_array_elements(coalesce(g.destinatarios, '[]'::jsonb)) d
    WHERE g.empresa_id = p_empresa AND tel_chave(d->>'numero') = v_chave
  ) THEN
    RAISE EXCEPTION 'Este número é da equipe (destinatário da Betina), não de cliente.' USING ERRCODE = 'P0001';
  END IF;

  SELECT w.id INTO v_id FROM whatsapp_contatos w WHERE w.empresa_id = p_empresa AND w.chave = v_chave;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT c.id INTO v_cli
  FROM clientes c
  WHERE c.empresa_id = p_empresa AND c.mesclado_em IS NULL
    AND (tel_chave(c.telefone) = v_chave OR tel_chave(c.whatsapp) = v_chave OR tel_chave(c.telefone_whatsapp) = v_chave)
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO whatsapp_contatos AS w (empresa_id, chave, telefone, cliente_id, status, total_mensagens)
  VALUES (p_empresa, v_chave, v_dig, v_cli, CASE WHEN v_cli IS NULL THEN 'novo' ELSE 'cliente' END, 0)
  ON CONFLICT (empresa_id, chave) DO UPDATE SET updated_at = now()
  RETURNING w.id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION whatsapp_abrir_conversa(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION whatsapp_abrir_conversa(UUID, TEXT) TO authenticated;
