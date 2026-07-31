-- ============================================================
-- URGENTE — Fechar leitura pública das tabelas de credencial
--
-- Diagnóstico feito contra a produção com a CHAVE PÚBLICA e SEM LOGIN
-- (a mesma chave que vai dentro do site e do aplicativo, e que qualquer
-- pessoa extrai do navegador em segundos):
--
--   marketplace_canais     → access_token e refresh_token do Mercado Livre
--                            e da Shopee, em texto puro
--   sistema_config_fiscal  → token da Brasil NFe
--   empresa_config_fiscal  → CSC da NFC-e, série e próxima numeração
--   whatsapp_config        → instance_id e token do WhatsApp
--   empresas               → razão social e CNPJ
--
-- Com o token do Mercado Livre um estranho altera preço, encerra anúncio e
-- lê pedido. Com o do WhatsApp, manda mensagem no seu nome. Isto não é
-- exposição de dado: é exposição de credencial.
--
-- Estas tabelas são usadas SÓ pelo painel web (tudo atrás de login) e pelas
-- rotinas de servidor (que usam a chave de serviço e não passam por RLS).
-- Por isso dá para fechá-las agora, sem depender de mudança no aplicativo.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Auxiliares ──────────────────────────────────────────────
-- SECURITY DEFINER de propósito: a política precisa enxergar `empresas`
-- mesmo depois de `empresas` ganhar RLS, senão a regra se morde.

CREATE OR REPLACE FUNCTION meu_tenant_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM empresas WHERE id = minha_empresa_id();
$$;

-- Empresa própria mais as do mesmo grupo — é disso que dependem Parcerias,
-- Mapa de Anúncios e a empresa fiscal/estoque configurável do PDV.
CREATE OR REPLACE FUNCTION empresa_do_meu_grupo(p_empresa UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_empresa = minha_empresa_id()
      OR (meu_tenant_id() IS NOT NULL
          AND p_empresa IN (SELECT id FROM empresas WHERE tenant_id = meu_tenant_id()));
$$;

GRANT EXECUTE ON FUNCTION meu_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION empresa_do_meu_grupo(UUID) TO authenticated;

-- ── Tokens de marketplace ───────────────────────────────────
ALTER TABLE marketplace_canais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "canais_do_grupo" ON marketplace_canais;
CREATE POLICY "canais_do_grupo" ON marketplace_canais
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── WhatsApp ────────────────────────────────────────────────
ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_do_grupo" ON whatsapp_config;
CREATE POLICY "whatsapp_do_grupo" ON whatsapp_config
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── Configuração fiscal da empresa ──────────────────────────
-- Grupo inteiro, e não só a própria empresa, porque a empresa que EMITE a
-- nota pode ser outra do mesmo grupo (configuração do PDV).
ALTER TABLE empresa_config_fiscal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "config_fiscal_do_grupo" ON empresa_config_fiscal;
CREATE POLICY "config_fiscal_do_grupo" ON empresa_config_fiscal
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(empresa_id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(empresa_id) OR is_system_admin());

-- ── Empresas ────────────────────────────────────────────────
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "empresas_do_grupo" ON empresas;
CREATE POLICY "empresas_do_grupo" ON empresas
  FOR ALL TO authenticated
  USING (empresa_do_meu_grupo(id) OR is_system_admin())
  WITH CHECK (empresa_do_meu_grupo(id) OR is_system_admin());

-- ── Configuração fiscal global (token da Brasil NFe) ────────
-- É configuração da plataforma, não do cliente: só administrador do sistema.
ALTER TABLE sistema_config_fiscal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sistema_fiscal_admin" ON sistema_config_fiscal;
CREATE POLICY "sistema_fiscal_admin" ON sistema_config_fiscal
  FOR ALL TO authenticated
  USING (is_system_admin()) WITH CHECK (is_system_admin());

-- O cadastro de empresa nova precisa saber qual provedor está ativo — mas
-- não pode ver o token. Esta função devolve só o nome do provedor.
CREATE OR REPLACE FUNCTION provider_fiscal_padrao()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT provider_padrao FROM sistema_config_fiscal LIMIT 1), 'focusnfe');
$$;
GRANT EXECUTE ON FUNCTION provider_fiscal_padrao() TO authenticated;

-- ============================================================
-- FICA DE FORA, e o motivo importa:
--
--   usuarios_pdv  → login e senha_hash dos operadores continuam legíveis.
--
-- Os 4 operadores do PDV externo NÃO têm conta no Supabase Auth: o terminal
-- entra pela chave pública, sem sessão. Ligar RLS aqui derruba o caixa na
-- hora. A correção certa é o terminal parar de ler a tabela e passar a
-- chamar a função abaixo, que confere a senha dentro do banco e nunca
-- devolve o hash. Depois que o terminal for atualizado, é só rodar:
--
--   ALTER TABLE usuarios_pdv ENABLE ROW LEVEL SECURITY;
--
-- e criar a política para o painel web (empresa_do_meu_grupo(empresa_id)).
-- ============================================================

CREATE OR REPLACE FUNCTION autenticar_operador_pdv(p_login TEXT, p_senha_hash TEXT)
RETURNS TABLE (
  id UUID, nome TEXT, cargo TEXT, empresa_id UUID, empresa_nome TEXT,
  empresa_fiscal_id UUID, empresa_estoque_id UUID, deposito_id UUID,
  unificar_estoque BOOLEAN, permissoes JSONB, limite_desconto NUMERIC
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nome, u.cargo, u.empresa_id, u.empresa_nome,
         u.empresa_fiscal_id, u.empresa_estoque_id, u.deposito_id,
         u.unificar_estoque, u.permissoes, u.limite_desconto
    FROM usuarios_pdv u
   WHERE lower(u.login) = lower(p_login)
     AND u.senha_hash = p_senha_hash
     AND u.ativo = true;
$$;
GRANT EXECUTE ON FUNCTION autenticar_operador_pdv(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- COMO DESFAZER, se alguma tela ficar em branco:
--
--   ALTER TABLE marketplace_canais    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE whatsapp_config       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE empresa_config_fiscal DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE empresas              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE sistema_config_fiscal DISABLE ROW LEVEL SECURITY;
--
-- Nenhum dado é alterado por este arquivo — ele só restringe quem lê.
-- ============================================================
