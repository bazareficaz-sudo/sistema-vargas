-- ============================================================
-- PERFIS FISCAIS — CFOP e CST/CSOSN por operação, não por produto
-- Execute no Supabase Dashboard → SQL Editor
--
-- O produto tinha UM campo de CFOP. Serve para a NFC-e (sempre balcão,
-- consumidor final, dentro do estado), não para a NF-e de marketplace, em que
-- o mesmo item sai como 5102, 6108 ou 6102 conforme quem compra e de onde.
--
-- Agora o produto aponta para um PERFIL ("Revenda tributada", "Revenda com
-- ST") e o perfil tem uma regra por situação × regime de quem emite. Mudar a
-- tributação de centenas de produtos vira editar uma linha do perfil.
-- A lógica que lê isto mora em src/lib/fiscal/perfilFiscal.ts.
--
-- O QUE ESTE ARQUIVO NÃO MUDA: a emissão de NFC-e do PDV continua usando o
-- CFOP/CST/CSOSN do cadastro do produto, exatamente como hoje. Os perfis
-- passam a valer na NF-e de marketplace, que ainda vai ser construída.
--
-- Pode rodar mais de uma vez: nada é duplicado e produto que já tem perfil
-- não é reclassificado.
-- ============================================================

-- ── 1. Tabelas ──────────────────────────────────────────────

-- Por grupo (tenant), e não por empresa: Bazar Eficaz e Ouro e Prata usam os
-- mesmos perfis. O que muda entre elas é o REGIME, que já é uma coluna das
-- regras.
CREATE TABLE IF NOT EXISTS perfis_fiscais (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  -- Marca os dois perfis criados por este arquivo ('tributada' | 'st'), para
  -- a classificação inicial achá-los mesmo se forem renomeados depois.
  chave       TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS perfis_fiscais_tenant_nome ON perfis_fiscais (tenant_id, lower(nome));
CREATE UNIQUE INDEX IF NOT EXISTS perfis_fiscais_tenant_chave ON perfis_fiscais (tenant_id, chave) WHERE chave IS NOT NULL;

-- Uma linha por perfil × regime × situação. Linhas, e não 16 colunas no
-- perfil, para uma exceção futura (por UF de destino, por exemplo) ser só
-- mais uma linha. CFOP e código vazios = "a definir": a emissão que cair
-- nessa regra para com uma mensagem, em vez de mandar um par chutado.
CREATE TABLE IF NOT EXISTS perfil_fiscal_regras (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id      UUID NOT NULL REFERENCES perfis_fiscais(id) ON DELETE CASCADE,
  regime         TEXT NOT NULL CHECK (regime IN ('simples', 'normal')),
  situacao       TEXT NOT NULL CHECK (situacao IN (
                   'interna_consumidor_final', 'interna_contribuinte',
                   'interestadual_consumidor_final', 'interestadual_contribuinte')),
  cfop           TEXT,
  icms_situacao  TEXT,   -- CSOSN (Simples) ou CST (regime normal), conforme `regime`
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perfil_id, regime, situacao)
);

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS perfil_fiscal_id UUID REFERENCES perfis_fiscais(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_perfil_fiscal ON produtos (perfil_fiscal_id);

-- ── 2. Acesso ───────────────────────────────────────────────
-- Ler: qualquer um do grupo (o cadastro de produto mostra o perfil).
-- Alterar: só quem pode editar a ficha do produto — mexer numa regra muda a
-- nota de todos os produtos do perfil.

ALTER TABLE perfis_fiscais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "perfis_fiscais_ler" ON perfis_fiscais;
CREATE POLICY "perfis_fiscais_ler" ON perfis_fiscais
  FOR SELECT TO authenticated
  USING (tenant_id = meu_tenant_id() OR is_system_admin());
DROP POLICY IF EXISTS "perfis_fiscais_alterar" ON perfis_fiscais;
CREATE POLICY "perfis_fiscais_alterar" ON perfis_fiscais
  FOR ALL TO authenticated
  USING ((tenant_id = meu_tenant_id() AND tem_permissao('editar_produtos')) OR is_system_admin())
  WITH CHECK ((tenant_id = meu_tenant_id() AND tem_permissao('editar_produtos')) OR is_system_admin());

ALTER TABLE perfil_fiscal_regras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "perfil_fiscal_regras_ler" ON perfil_fiscal_regras;
CREATE POLICY "perfil_fiscal_regras_ler" ON perfil_fiscal_regras
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM perfis_fiscais p WHERE p.id = perfil_id
                 AND (p.tenant_id = meu_tenant_id() OR is_system_admin())));
DROP POLICY IF EXISTS "perfil_fiscal_regras_alterar" ON perfil_fiscal_regras;
CREATE POLICY "perfil_fiscal_regras_alterar" ON perfil_fiscal_regras
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM perfis_fiscais p WHERE p.id = perfil_id
                 AND ((p.tenant_id = meu_tenant_id() AND tem_permissao('editar_produtos')) OR is_system_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis_fiscais p WHERE p.id = perfil_id
                 AND ((p.tenant_id = meu_tenant_id() AND tem_permissao('editar_produtos')) OR is_system_admin())));

-- ── 3. Perfis padrão para cada grupo ────────────────────────

INSERT INTO perfis_fiscais (tenant_id, nome, descricao, chave)
SELECT DISTINCT e.tenant_id, v.nome, v.descricao, v.chave
  FROM empresas e
 CROSS JOIN (VALUES
   ('Revenda tributada', 'Mercadoria de terceiros sem substituição tributária.', 'tributada'),
   ('Revenda com ST',    'Mercadoria que entra com ICMS-ST já recolhido pelo fornecedor.', 'st')
 ) AS v(nome, descricao, chave)
 WHERE e.tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Mesmas regras de REGRAS_PADRAO em src/lib/fiscal/perfilFiscal.ts.
-- As interestaduais do perfil com ST ficam VAZIAS: revender para outro estado
-- mercadoria com ST já recolhido não tem par único (CST 00 / CSOSN 102 com
-- pedido de ressarcimento, ou 60 / 500) — é a contabilidade que define.
INSERT INTO perfil_fiscal_regras (perfil_id, regime, situacao, cfop, icms_situacao)
SELECT p.id, r.regime, r.situacao, r.cfop, r.icms
  FROM perfis_fiscais p
  JOIN (VALUES
    ('tributada', 'simples', 'interna_consumidor_final',       '5102'::text, '102'::text),
    ('tributada', 'simples', 'interna_contribuinte',           '5102', '102'),
    ('tributada', 'simples', 'interestadual_consumidor_final', '6108', '102'),
    ('tributada', 'simples', 'interestadual_contribuinte',     '6102', '102'),
    ('tributada', 'normal',  'interna_consumidor_final',       '5102', '00'),
    ('tributada', 'normal',  'interna_contribuinte',           '5102', '00'),
    ('tributada', 'normal',  'interestadual_consumidor_final', '6108', '00'),
    ('tributada', 'normal',  'interestadual_contribuinte',     '6102', '00'),
    ('st',        'simples', 'interna_consumidor_final',       '5405', '500'),
    ('st',        'simples', 'interna_contribuinte',           '5405', '500'),
    ('st',        'simples', 'interestadual_consumidor_final', NULL,   NULL),
    ('st',        'simples', 'interestadual_contribuinte',     NULL,   NULL),
    ('st',        'normal',  'interna_consumidor_final',       '5405', '60'),
    ('st',        'normal',  'interna_contribuinte',           '5405', '60'),
    ('st',        'normal',  'interestadual_consumidor_final', NULL,   NULL),
    ('st',        'normal',  'interestadual_contribuinte',     NULL,   NULL)
  ) AS r(chave, regime, situacao, cfop, icms) ON r.chave = p.chave
ON CONFLICT (perfil_id, regime, situacao) DO NOTHING;

-- ── 4. Classificação inicial dos produtos ───────────────────
-- Ninguém precisa abrir produto por produto: o cadastro atual já diz quem
-- tem ST. Qualquer sinal de ST em qualquer dos três campos basta, porque os
-- campos foram misturados ao longo do tempo (há CSOSN gravado em icms_cst e
-- CST 60 em empresa do Simples — ver coerencia.ts). Na dúvida, "com ST": um
-- produto com ST marcado como tributado sai com imposto a maior na nota; o
-- contrário é recusado pela SEFAZ ao emitir, e aparece.
--
-- Efeito colateral esperado: `updated_at` dos produtos classificados muda
-- (trigger trg_produtos_updated_at), e o PDV externo rebaixa esses produtos
-- uma vez na próxima sincronização. Estoque e preço não mudam, então a fila
-- de marketplace não é acionada.

UPDATE produtos pr
   SET perfil_fiscal_id = p.id
  FROM empresas e, perfis_fiscais p
 WHERE pr.empresa_id = e.id
   AND p.tenant_id = e.tenant_id
   AND pr.perfil_fiscal_id IS NULL
   AND p.chave = CASE
         WHEN pr.csosn    IN ('201', '202', '203', '500')
           OR pr.icms_cst IN ('10', '30', '60', '70', '201', '202', '203', '500')
           OR pr.cfop     IN ('5401', '5402', '5403', '5405')
         THEN 'st' ELSE 'tributada' END;

-- ── 5. Trocar o perfil exige a mesma permissão da ficha ─────
-- Criado DEPOIS da classificação acima de propósito (embora o SQL Editor,
-- sem usuário logado, já passasse por tem_permissao). Fica num gatilho à
-- parte para não reescrever produtos_checar_permissao, que vive em
-- supabase-permissoes-fase2.sql.

CREATE OR REPLACE FUNCTION produtos_checar_permissao_perfil_fiscal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.perfil_fiscal_id IS DISTINCT FROM OLD.perfil_fiscal_id
     AND NOT tem_permissao('editar_produtos') THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar o perfil fiscal do produto.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_permissao_perfil_fiscal ON produtos;
CREATE TRIGGER trg_produtos_permissao_perfil_fiscal
  BEFORE UPDATE OF perfil_fiscal_id ON produtos
  FOR EACH ROW EXECUTE FUNCTION produtos_checar_permissao_perfil_fiscal();

-- ── 6. Mudança em massa por NCM ─────────────────────────────
-- "Todo produto com NCM começando em 8481 é Revenda com ST." ST é atributo da
-- mercadoria, e a mercadoria é identificada pelo NCM — então a forma natural
-- de corrigir em massa é por prefixo de NCM, em todas as empresas do grupo.
--
-- No banco, e não na tela, porque o NCM está gravado com e sem pontos
-- ("8481.80.19" e "84818019") e um LIKE do cliente perderia metade.
-- SECURITY INVOKER (o padrão): roda com a RLS e os gatilhos de quem chama,
-- inclusive o de permissão acima.
--
-- p_simular = true só conta, para a tela mostrar "isto vai mover N produtos"
-- antes de mover.

CREATE OR REPLACE FUNCTION atribuir_perfil_fiscal_por_ncm(
  p_perfil UUID, p_ncm_prefixo TEXT, p_somente_sem_perfil BOOLEAN DEFAULT false, p_simular BOOLEAN DEFAULT true
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_prefixo TEXT := regexp_replace(COALESCE(p_ncm_prefixo, ''), '\D', '', 'g');
  v_total INTEGER;
BEGIN
  IF length(v_prefixo) < 2 THEN
    RAISE EXCEPTION 'Informe ao menos os 2 primeiros dígitos do NCM.';
  END IF;
  SELECT tenant_id INTO v_tenant FROM perfis_fiscais WHERE id = p_perfil AND ativo;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Perfil fiscal não encontrado.';
  END IF;

  IF p_simular THEN
    SELECT count(*) INTO v_total
      FROM produtos pr JOIN empresas e ON e.id = pr.empresa_id
     WHERE e.tenant_id = v_tenant
       AND regexp_replace(COALESCE(pr.ncm, ''), '\D', '', 'g') LIKE v_prefixo || '%'
       AND pr.perfil_fiscal_id IS DISTINCT FROM p_perfil
       AND (NOT p_somente_sem_perfil OR pr.perfil_fiscal_id IS NULL);
    RETURN v_total;
  END IF;

  UPDATE produtos pr SET perfil_fiscal_id = p_perfil
    FROM empresas e
   WHERE e.id = pr.empresa_id
     AND e.tenant_id = v_tenant
     AND regexp_replace(COALESCE(pr.ncm, ''), '\D', '', 'g') LIKE v_prefixo || '%'
     AND pr.perfil_fiscal_id IS DISTINCT FROM p_perfil
     AND (NOT p_somente_sem_perfil OR pr.perfil_fiscal_id IS NULL);
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;
GRANT EXECUTE ON FUNCTION atribuir_perfil_fiscal_por_ncm(UUID, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── 7. Conferência ──────────────────────────────────────────
-- Quantos produtos ficaram em cada perfil, por empresa:
--
--   SELECT e.nome AS empresa, pf.nome AS perfil, count(*)
--     FROM produtos pr
--     JOIN empresas e ON e.id = pr.empresa_id
--     LEFT JOIN perfis_fiscais pf ON pf.id = pr.perfil_fiscal_id
--    GROUP BY 1, 2 ORDER BY 1, 2;
--
-- Produtos com NCM na tabela de ST (Convênio 142/2018) que ficaram como
-- "Revenda tributada" — candidatos a revisar com a contabilidade:
--
--   SELECT pr.sku, pr.nome, pr.ncm
--     FROM produtos pr
--     JOIN perfis_fiscais pf ON pf.id = pr.perfil_fiscal_id AND pf.chave = 'tributada'
--    WHERE EXISTS (SELECT 1 FROM cest_tabela c
--                   WHERE regexp_replace(pr.ncm, '\D', '', 'g') LIKE c.ncm_prefixo || '%')
--    ORDER BY pr.nome;
--
-- ============================================================
-- COMO DESFAZER:
--
--   DROP FUNCTION IF EXISTS atribuir_perfil_fiscal_por_ncm(UUID, TEXT, BOOLEAN, BOOLEAN);
--   DROP TRIGGER IF EXISTS trg_produtos_permissao_perfil_fiscal ON produtos;
--   ALTER TABLE produtos DROP COLUMN IF EXISTS perfil_fiscal_id;
--   DROP TABLE IF EXISTS perfil_fiscal_regras;
--   DROP TABLE IF EXISTS perfis_fiscais;
--
-- Nenhum campo fiscal existente do produto (cfop, csosn, icms_cst...) é
-- alterado por este arquivo.
-- ============================================================
