-- CATEGORIAS DE CLIENTE (etiquetas): Eletricista, Bombeiro hidráulico,
-- Pedreiro… para marcar o cliente e depois filtrar (clientes, conversas do
-- WhatsApp, relatório). Um cliente pode ter várias.
--
-- 1. cliente_categorias: as etiquetas da empresa (nome único sem diferenciar
--    maiúscula, cor de uma lista fixa). Quem é da empresa cria, muda e apaga.
-- 2. cliente_categoria_vinculos: cliente ↔ categoria. A empresa do vínculo
--    vem do cliente (gatilho) e a categoria precisa ser da mesma empresa.
-- 3. Cliente unificado em outro: as categorias passam para o destino.
-- 4. View cliente_categorias_contagem: quantos clientes em cada uma.
-- 5. View whatsapp_conversas: coluna `categorias` (ids) no fim, para filtrar
--    as conversas por categoria do cliente.
--
-- Nada é criado para as empresas: a tela oferece as sugestões quando não há
-- nenhuma. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS cliente_categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 40),
  cor         TEXT NOT NULL DEFAULT 'cinza'
              CHECK (cor IN ('cinza', 'vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_categorias_nome
  ON cliente_categorias (empresa_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS cliente_categoria_vinculos (
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  categoria_id  UUID NOT NULL REFERENCES cliente_categorias(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS idx_cliente_categoria_vinculos_categoria
  ON cliente_categoria_vinculos (categoria_id);
CREATE INDEX IF NOT EXISTS idx_cliente_categoria_vinculos_empresa
  ON cliente_categoria_vinculos (empresa_id);

COMMENT ON TABLE cliente_categorias IS 'Etiquetas de cliente da empresa (ex.: Eletricista, Pedreiro) para marcar e filtrar.';
COMMENT ON TABLE cliente_categoria_vinculos IS 'Cliente marcado com uma categoria. empresa_id vem do cliente.';

-- Empresa do vínculo = empresa do cliente; categoria de outra empresa não entra.
CREATE OR REPLACE FUNCTION cliente_categoria_vinculo_conferir()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa UUID;
BEGIN
  SELECT c.empresa_id INTO v_empresa FROM clientes c WHERE c.id = NEW.cliente_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cliente_categorias k WHERE k.id = NEW.categoria_id AND k.empresa_id = v_empresa) THEN
    RAISE EXCEPTION 'Categoria de outra empresa.' USING ERRCODE = '23514';
  END IF;
  NEW.empresa_id := v_empresa;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cliente_categoria_vinculo_conferir ON cliente_categoria_vinculos;
CREATE TRIGGER trg_cliente_categoria_vinculo_conferir
  BEFORE INSERT OR UPDATE ON cliente_categoria_vinculos
  FOR EACH ROW EXECUTE FUNCTION cliente_categoria_vinculo_conferir();

-- Unificou o cadastro: as categorias seguem para o destino.
CREATE OR REPLACE FUNCTION cliente_categorias_seguir_mescla()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mesclado_em IS NOT NULL AND NEW.mesclado_em IS DISTINCT FROM OLD.mesclado_em THEN
    INSERT INTO cliente_categoria_vinculos (cliente_id, categoria_id, empresa_id)
    SELECT NEW.mesclado_em, v.categoria_id, v.empresa_id
      FROM cliente_categoria_vinculos v
     WHERE v.cliente_id = NEW.id
    ON CONFLICT (cliente_id, categoria_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cliente_categorias_seguir_mescla ON clientes;
CREATE TRIGGER trg_cliente_categorias_seguir_mescla
  AFTER UPDATE OF mesclado_em ON clientes
  FOR EACH ROW EXECUTE FUNCTION cliente_categorias_seguir_mescla();

REVOKE ALL ON FUNCTION cliente_categoria_vinculo_conferir() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cliente_categorias_seguir_mescla() FROM PUBLIC, anon, authenticated;

-- ── Acesso: só quem é da empresa (mesma regra das outras tabelas) ────────
ALTER TABLE cliente_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_categoria_vinculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_categorias_empresa ON cliente_categorias;
CREATE POLICY cliente_categorias_empresa ON cliente_categorias
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

DROP POLICY IF EXISTS cliente_categoria_vinculos_empresa ON cliente_categoria_vinculos;
CREATE POLICY cliente_categoria_vinculos_empresa ON cliente_categoria_vinculos
  FOR ALL USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

REVOKE ALL ON cliente_categorias, cliente_categoria_vinculos FROM anon;
GRANT SELECT, INSERT, DELETE ON cliente_categorias, cliente_categoria_vinculos TO authenticated;
GRANT UPDATE (nome, cor, updated_at) ON cliente_categorias TO authenticated;
GRANT ALL ON cliente_categorias, cliente_categoria_vinculos TO service_role;

-- ── Quantos clientes em cada categoria (sem os unificados noutro) ────────
CREATE OR REPLACE VIEW cliente_categorias_contagem WITH (security_invoker = true) AS
SELECT k.id, k.empresa_id, k.nome, k.cor,
       count(c.id)::int AS clientes
  FROM cliente_categorias k
  LEFT JOIN cliente_categoria_vinculos v ON v.categoria_id = k.id
  LEFT JOIN clientes c ON c.id = v.cliente_id AND c.mesclado_em IS NULL
 GROUP BY k.id, k.empresa_id, k.nome, k.cor;

REVOKE ALL ON cliente_categorias_contagem FROM anon;
GRANT SELECT ON cliente_categorias_contagem TO authenticated;

-- ── View das conversas: categorias do cliente no fim ─────────────────────
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
    w.lid,
    COALESCE((SELECT array_agg(v.categoria_id ORDER BY v.categoria_id)
                FROM cliente_categoria_vinculos v
               WHERE v.cliente_id = w.cliente_id), '{}'::uuid[]) AS categorias
   FROM whatsapp_contatos w
     LEFT JOIN clientes c ON c.id = w.cliente_id;

REVOKE ALL ON whatsapp_conversas FROM anon;
GRANT SELECT ON whatsapp_conversas TO authenticated;
