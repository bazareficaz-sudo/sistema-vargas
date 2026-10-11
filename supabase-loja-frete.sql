-- ════════════════════════════════════════════════════════════════════════════
-- LOJA ONLINE — FRETE E ENTREGA
-- ════════════════════════════════════════════════════════════════════════════
--
-- O que isto cria: tabelas de configuração do frete. NADA em tabela existente
-- é alterado, e nenhum dado é tocado. A loja só passa a calcular frete quando
-- `loja_frete_config.ativo = true` — até lá o comportamento é o de hoje (frete
-- combinado pelo WhatsApp).
--
-- Como o frete funciona
--   1. O cliente informa o CEP no checkout.
--   2. O sistema descobre bairro/cidade (e as coordenadas, para distância).
--   3. As REGRAS abaixo são avaliadas na ordem de `prioridade`. Para cada
--      `servico` (ex.: "Entrega", "Entrega expressa") vale a PRIMEIRA regra
--      que casa com o endereço e com o pedido.
--   4. O valor sai do tipo de cálculo da regra + adicionais de peso/produto.
--
-- Tipos de ÁREA (onde a regra vale):
--   toda_loja  → qualquer endereço (serve de regra "padrão" no fim da fila)
--   bairros    → lista de bairros (+ cidade opcional)
--   cep        → faixas de CEP
--   raio       → distância da loja, entre km_min e km_max
--
-- Tipos de CÁLCULO (quanto custa):
--   fixo       → `valor_fixo`
--   por_km     → `valor_base` + km × `valor_por_km`
--   faixas     → tabela `faixas` ([{ate, valor}]), medida em `faixas_base`:
--                'distancia' (km) | 'peso' (kg) | 'subtotal' (R$ do pedido)
--
-- Adicionais (valem para qualquer cálculo): peso acima da franquia, e valor
-- por unidade de produto marcado em `loja_frete_produtos`.
--
-- COMO DESFAZER: DROP TABLE loja_frete_produtos, loja_frete_regras,
-- loja_frete_config; — nada mais depende delas.

CREATE TABLE IF NOT EXISTS loja_frete_config (
  loja_id              UUID PRIMARY KEY REFERENCES loja_config(id) ON DELETE CASCADE,
  empresa_id           UUID NOT NULL,
  ativo                BOOLEAN NOT NULL DEFAULT false,

  -- Ponto de partida das distâncias. Preenchido pelo botão "Localizar" do
  -- painel (a partir do endereço da loja) ou à mão.
  origem_lat           NUMERIC(9,6),
  origem_lng           NUMERIC(9,6),

  -- Distância em linha reta × este fator ≈ distância por rua. 1.30 é um bom
  -- ponto de partida para cidade; ajuste comparando com o que a loja já cobra.
  fator_estrada        NUMERIC(4,2) NOT NULL DEFAULT 1.30,

  frete_gratis_acima   NUMERIC(12,2),
  pedido_minimo        NUMERIC(12,2),

  -- Endereço que nenhuma regra alcança: 'combinar' (cliente fecha o pedido e
  -- a loja combina o valor) ou 'nao_entrega' (só retirada).
  sem_regra            TEXT NOT NULL DEFAULT 'combinar'
                       CHECK (sem_regra IN ('combinar', 'nao_entrega')),

  -- Peso assumido para produto sem peso cadastrado.
  peso_padrao_kg       NUMERIC(8,3) NOT NULL DEFAULT 0.300,

  -- Arredonda o frete PARA CIMA para múltiplos deste valor (ex.: 0.50).
  arredondar_para      NUMERIC(6,2),

  mensagem             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loja_frete_regras (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL,
  loja_id              UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,

  nome                 TEXT NOT NULL,
  servico              TEXT NOT NULL DEFAULT 'Entrega',
  ativo                BOOLEAN NOT NULL DEFAULT true,
  prioridade           INTEGER NOT NULL DEFAULT 100,

  -- ── Onde vale ──
  area_tipo            TEXT NOT NULL DEFAULT 'toda_loja'
                       CHECK (area_tipo IN ('toda_loja', 'bairros', 'cep', 'raio')),
  bairros              TEXT[] NOT NULL DEFAULT '{}',
  cidade               TEXT,
  cep_faixas           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"de":"01000000","ate":"01999999"}]
  km_min               NUMERIC(8,2),
  km_max               NUMERIC(8,2),

  -- ── Quanto custa ──
  calculo_tipo         TEXT NOT NULL DEFAULT 'fixo'
                       CHECK (calculo_tipo IN ('fixo', 'por_km', 'faixas')),
  valor_fixo           NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_base           NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_por_km         NUMERIC(12,2) NOT NULL DEFAULT 0,
  faixas_base          TEXT NOT NULL DEFAULT 'distancia'
                       CHECK (faixas_base IN ('distancia', 'peso', 'subtotal')),
  faixas               JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"ate":5,"valor":8},{"ate":null,"valor":15}]

  -- ── Adicionais e limites ──
  peso_franquia_kg     NUMERIC(8,3),          -- até aqui o peso não cobra extra
  adicional_por_kg     NUMERIC(12,2) NOT NULL DEFAULT 0,
  peso_max_kg          NUMERIC(8,3),          -- acima disto a regra não se aplica
  frete_gratis_acima   NUMERIC(12,2),
  pedido_minimo        NUMERIC(12,2),
  prazo_texto          TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loja_frete_regras_loja_idx
  ON loja_frete_regras (loja_id, prioridade);

-- Regra especial por produto: um registro por produto e loja.
CREATE TABLE IF NOT EXISTS loja_frete_produtos (
  loja_id              UUID NOT NULL REFERENCES loja_config(id) ON DELETE CASCADE,
  produto_id           UUID NOT NULL,
  empresa_id           UUID NOT NULL,

  frete_gratis         BOOLEAN NOT NULL DEFAULT false,   -- não pesa nem cobra no frete
  somente_retirada     BOOLEAN NOT NULL DEFAULT false,   -- não entrega (volumoso, frágil...)
  adicional_unidade    NUMERIC(12,2) NOT NULL DEFAULT 0, -- soma ao frete, por unidade
  peso_kg              NUMERIC(8,3),                     -- substitui o peso do cadastro

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (loja_id, produto_id)
);

-- ── Segurança: mesmo padrão das demais tabelas da loja ─────────────────────
-- O anônimo não enxerga nada daqui; a vitrine lê pelo servidor (chave de
-- serviço). O painel escreve com a sessão do usuário, sob a política do grupo.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['loja_frete_config', 'loja_frete_regras', 'loja_frete_produtos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_do_grupo', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL TO authenticated
                      USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
                      WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin())$p$,
                   t || '_do_grupo', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── CONFERÊNCIA (rode depois) ──────────────────────────────────────────────
-- Esperado: 3 linhas, rls = true, anon_le = false.
--   SELECT c.relname, c.relrowsecurity AS rls,
--          has_table_privilege('anon', c.oid, 'SELECT') AS anon_le
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname LIKE 'loja_frete_%'
--    ORDER BY 1;
