-- Anúncios Rascunhos + tokens da extensão do Chrome
-- ==================================================
--
-- Fase 1 do módulo: a estrutura onde a captura cai, e a credencial que a
-- extensão usa para falar com o sistema.
--
-- Rodar ANTES do deploy do código correspondente.


-- ── 1. Tokens da extensão ───────────────────────────────────────────────────
--
-- A extensão não pode carregar a senha do usuário nem as credenciais dos
-- marketplaces. Ela carrega um token próprio, que:
--   • é gerado no sistema e mostrado UMA vez;
--   • fica guardado aqui só como hash (roubar o banco não dá acesso);
--   • pertence a um usuário e a uma empresa;
--   • expira;
--   • pode ser revogado a qualquer momento;
--   • registra último uso, para o dono ver atividade estranha.

CREATE TABLE IF NOT EXISTS extensao_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_dispositivo TEXT NOT NULL,
  -- SHA-256 do token. O valor em claro só existe no momento da criação.
  token_hash      TEXT NOT NULL UNIQUE,
  -- Primeiros caracteres, para o usuário reconhecer o token na lista sem
  -- que isso sirva para autenticar.
  token_prefixo   TEXT NOT NULL,
  expira_em       TIMESTAMPTZ NOT NULL,
  ultimo_uso_em   TIMESTAMPTZ,
  ultimo_uso_ip   TEXT,
  total_capturas  INTEGER NOT NULL DEFAULT 0,
  revogado_em     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extensao_tokens_hash ON extensao_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_extensao_tokens_user ON extensao_tokens(user_id);

ALTER TABLE extensao_tokens ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga e revoga só os próprios tokens. A criação e a validação
-- passam por rota de servidor com chave de serviço — token nunca é criado
-- direto do navegador.
DROP POLICY IF EXISTS "extensao_tokens_proprios" ON extensao_tokens;
CREATE POLICY "extensao_tokens_proprios" ON extensao_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 2. Rascunhos de anúncio ────────────────────────────────────────────────
--
-- Um rascunho é uma REFERÊNCIA, não um anúncio. Ele guarda o que foi
-- capturado sem alteração (`dados_origem`) separado do que o operador
-- editou (`dados_editados`) — o documento pede explicitamente que dado
-- capturado, inferido e alterado não se misturem.

CREATE TABLE IF NOT EXISTS anuncio_rascunhos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,

  -- Origem
  origem          TEXT NOT NULL DEFAULT 'extensao',   -- extensao | url | manual
  origem_marketplace TEXT,                            -- mercadolivre | shopee | outro
  origem_id_externo  TEXT,                            -- MLB1234567890
  origem_url      TEXT,
  origem_vendedor TEXT,

  -- Conteúdo capturado, exatamente como veio. Nunca é sobrescrito por edição.
  dados_origem    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Conteúdo trabalhado pelo operador (título, descrição, imagens escolhidas...)
  dados_editados  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Campos "de trabalho", desnormalizados do JSON para a listagem poder
  -- filtrar e ordenar sem abrir cada registro.
  titulo          TEXT,
  preco_origem    NUMERIC(12,2),
  imagem_principal TEXT,
  qtd_imagens     INTEGER NOT NULL DEFAULT 0,
  tem_variacao    BOOLEAN NOT NULL DEFAULT false,

  -- Vínculo com o ERP
  produto_id      UUID REFERENCES produtos(id) ON DELETE SET NULL,
  mapeamento_metodo TEXT,        -- sku | ean | nome | manual
  mapeamento_score  INTEGER,

  status          TEXT NOT NULL DEFAULT 'capturado',
  colecao         TEXT,
  observacao      TEXT,

  capturado_por   UUID REFERENCES auth.users(id),
  capturado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivado_em    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Evita capturar duas vezes o mesmo anúncio na mesma empresa. Sem isso, um
  -- clique repetido na extensão criaria rascunho duplicado em silêncio.
  CONSTRAINT anuncio_rascunhos_origem_unica
    UNIQUE (empresa_id, origem_marketplace, origem_id_externo)
);

CREATE INDEX IF NOT EXISTS idx_rascunhos_empresa_status ON anuncio_rascunhos(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_rascunhos_produto ON anuncio_rascunhos(produto_id);
CREATE INDEX IF NOT EXISTS idx_rascunhos_capturado_em ON anuncio_rascunhos(capturado_em DESC);

ALTER TABLE anuncio_rascunhos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rascunhos_do_grupo" ON anuncio_rascunhos;
CREATE POLICY "rascunhos_do_grupo" ON anuncio_rascunhos
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());


-- ── 3. Histórico ───────────────────────────────────────────────────────────
--
-- Exigência da seção 21 do documento: quem capturou, quem alterou, o que
-- mudou. Guardado desde a Fase 1 porque histórico não se recupera depois.

CREATE TABLE IF NOT EXISTS anuncio_rascunho_historico (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rascunho_id  UUID NOT NULL REFERENCES anuncio_rascunhos(id) ON DELETE CASCADE,
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id),
  usuario_nome TEXT,
  acao         TEXT NOT NULL,      -- capturado | editado | mapeado | status | arquivado
  dados_antes  JSONB,
  dados_depois JSONB,
  observacao   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rascunho_hist ON anuncio_rascunho_historico(rascunho_id, created_at DESC);

ALTER TABLE anuncio_rascunho_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rascunho_hist_do_grupo" ON anuncio_rascunho_historico;
CREATE POLICY "rascunho_hist_do_grupo" ON anuncio_rascunho_historico
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());


-- ── Conferência ────────────────────────────────────────────────────────────

SELECT 'extensao_tokens' AS tabela, count(*) FROM extensao_tokens
UNION ALL SELECT 'anuncio_rascunhos', count(*) FROM anuncio_rascunhos
UNION ALL SELECT 'anuncio_rascunho_historico', count(*) FROM anuncio_rascunho_historico;
