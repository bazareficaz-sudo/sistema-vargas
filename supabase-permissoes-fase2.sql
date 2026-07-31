-- ============================================================
-- Permissões — Fase 2: restrição que vale de verdade
--
-- Na Fase 1 as permissões podiam ser configuradas, mas quem realmente
-- bloqueava era só a tela: quem chamasse o banco por fora (o aplicativo do
-- celular, o PDV externo, ou qualquer ferramenta) passava direto.
--
-- Aqui a regra desce para o banco. Um TRIGGER dispara para qualquer
-- gravação, venha de onde vier — web, app ou terminal. É por isso que este
-- é o único jeito de a configuração "refletir também no app": o app não
-- passa pelo servidor da web, ele conversa com o Supabase diretamente.
--
-- Execute no Supabase Dashboard → SQL Editor
-- ============================================================

-- ── A matriz, agora também em SQL ───────────────────────────
--
-- Espelha src/lib/auth/permissoes.ts. Mudou lá, muda aqui — a duplicação é
-- deliberada: TypeScript não roda dentro do Postgres, e sem a matriz no
-- banco não existe bloqueio real.

CREATE OR REPLACE FUNCTION permissoes_do_papel(p_papel TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_papel
    WHEN 'admin' THEN ARRAY[
      'gerenciar_usuarios','gerenciar_configuracoes','ver_custos_margens','excluir_cadastros',
      'gerenciar_financeiro','gerenciar_estoque','gerenciar_compras','gerenciar_fiscal',
      'gerenciar_marketplaces','realizar_vendas','cancelar_venda','gerenciar_whatsapp','exportar_dados',
      'ver_dados_grupo','ver_totais_vendas','ver_dashboard_financeiro',
      'editar_produtos','editar_precos','editar_credito_cliente']
    WHEN 'gerente' THEN ARRAY[
      'ver_custos_margens','excluir_cadastros','gerenciar_financeiro','gerenciar_estoque',
      'gerenciar_compras','gerenciar_fiscal','gerenciar_marketplaces','realizar_vendas',
      'cancelar_venda','gerenciar_whatsapp','exportar_dados','ver_dados_grupo',
      'ver_totais_vendas','ver_dashboard_financeiro',
      'editar_produtos','editar_precos','editar_credito_cliente']
    WHEN 'financeiro' THEN ARRAY[
      'ver_custos_margens','gerenciar_financeiro','gerenciar_fiscal','exportar_dados',
      'ver_totais_vendas','ver_dashboard_financeiro','editar_credito_cliente']
    WHEN 'estoque' THEN ARRAY[
      'ver_custos_margens','gerenciar_estoque','gerenciar_compras','exportar_dados',
      'editar_produtos']
    WHEN 'vendas' THEN ARRAY['realizar_vendas']
    WHEN 'leitura' THEN ARRAY[]::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- Papel + exceções configuradas em Usuários → Permissões.
CREATE OR REPLACE FUNCTION permissoes_efetivas_de(p_usuario UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_papel  TEXT;
  v_status TEXT;
  v_lista  TEXT[];
BEGIN
  SELECT role, status INTO v_papel, v_status FROM profiles WHERE id = p_usuario;
  IF v_papel IS NULL THEN RETURN ARRAY[]::TEXT[]; END IF;
  -- Usuário inativo ou bloqueado não tem permissão nenhuma, qualquer que
  -- seja o papel.
  IF v_status IS NOT NULL AND v_status <> 'ativo' AND v_status <> 'convite_pendente' THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  v_lista := permissoes_do_papel(v_papel);

  -- Exceções somam ou tiram, uma a uma: o que o papel dá menos o que foi
  -- revogado, mais o que foi liberado fora do papel.
  SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::TEXT[]) INTO v_lista
  FROM (
    SELECT t.c
      FROM unnest(v_lista) AS t(c)
     WHERE NOT EXISTS (
       SELECT 1 FROM usuario_permissoes up
        WHERE up.usuario_id = p_usuario AND up.codigo = t.c AND up.permitido = false
     )
    UNION
    SELECT up.codigo
      FROM usuario_permissoes up
     WHERE up.usuario_id = p_usuario AND up.permitido = true
  ) AS x(c);

  RETURN v_lista;
END;
$$;

-- Chamada pelo aplicativo do celular via RPC: devolve as permissões de quem
-- está logado. É a fonte única — o app não precisa (nem deve) reimplementar
-- a matriz.
CREATE OR REPLACE FUNCTION permissoes_efetivas()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN ARRAY[]::TEXT[] ELSE permissoes_efetivas_de(auth.uid()) END;
$$;

CREATE OR REPLACE FUNCTION tem_permissao(p_codigo TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Sem usuário logado = chamada de servidor (cron, rotina administrativa,
  -- service role). Essas continuam passando: quem as dispara já foi
  -- autorizado antes, e travá-las aqui quebraria a sincronização e as
  -- automações. O bloqueio aqui é sobre PESSOA, não sobre processo.
  SELECT auth.uid() IS NULL OR p_codigo = ANY(permissoes_efetivas_de(auth.uid()));
$$;

GRANT EXECUTE ON FUNCTION permissoes_efetivas() TO authenticated;
GRANT EXECUTE ON FUNCTION tem_permissao(TEXT) TO authenticated;

-- ── Produtos ────────────────────────────────────────────────
--
-- O cuidado central: NÃO travar a coluna `estoque`. Toda venda no PDV
-- decrementa estoque, e o operador de vendas não tem (nem deve ter)
-- permissão de editar produto. Travar a tabela inteira faria a venda
-- falhar. Por isso o trigger olha QUAIS colunas mudaram.

CREATE OR REPLACE FUNCTION produtos_checar_permissao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT tem_permissao('editar_produtos') THEN
      RAISE EXCEPTION 'Você não tem permissão para cadastrar produtos.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT tem_permissao('excluir_cadastros') THEN
      RAISE EXCEPTION 'Você não tem permissão para excluir produtos.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- Preço de venda: permissão própria, separada da ficha do produto.
  IF (NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
      OR NEW.preco_promocional IS DISTINCT FROM OLD.preco_promocional
      OR NEW.promocao_ativa IS DISTINCT FROM OLD.promocao_ativa
      OR NEW.markup IS DISTINCT FROM OLD.markup)
     AND NOT tem_permissao('editar_precos') THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar o preço de venda.' USING ERRCODE = '42501';
  END IF;

  -- Desativar cadastro é o "excluir" deste sistema.
  IF NEW.ativo IS DISTINCT FROM OLD.ativo AND NOT tem_permissao('excluir_cadastros') THEN
    RAISE EXCEPTION 'Você não tem permissão para ativar ou desativar cadastros.' USING ERRCODE = '42501';
  END IF;

  -- Ficha do produto: identidade, fiscal, dimensões e custo. Custo entra
  -- aqui (e não em preço de venda) porque vem da compra, não da política
  -- comercial.
  IF (NEW.nome IS DISTINCT FROM OLD.nome
      OR NEW.sku IS DISTINCT FROM OLD.sku
      OR NEW.ean IS DISTINCT FROM OLD.ean
      OR NEW.categoria IS DISTINCT FROM OLD.categoria
      OR NEW.marca IS DISTINCT FROM OLD.marca
      OR NEW.unidade IS DISTINCT FROM OLD.unidade
      OR NEW.tipo IS DISTINCT FROM OLD.tipo
      OR NEW.preco_custo IS DISTINCT FROM OLD.preco_custo
      OR NEW.descricao_marketplace IS DISTINCT FROM OLD.descricao_marketplace
      OR NEW.ncm IS DISTINCT FROM OLD.ncm
      OR NEW.cest IS DISTINCT FROM OLD.cest
      OR NEW.cfop IS DISTINCT FROM OLD.cfop
      OR NEW.csosn IS DISTINCT FROM OLD.csosn
      OR NEW.icms_cst IS DISTINCT FROM OLD.icms_cst
      OR NEW.peso_kg IS DISTINCT FROM OLD.peso_kg
      OR NEW.comprimento_cm IS DISTINCT FROM OLD.comprimento_cm
      OR NEW.largura_cm IS DISTINCT FROM OLD.largura_cm
      OR NEW.altura_cm IS DISTINCT FROM OLD.altura_cm
      OR NEW.estoque_minimo IS DISTINCT FROM OLD.estoque_minimo)
     AND NOT tem_permissao('editar_produtos') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar a ficha do produto.' USING ERRCODE = '42501';
  END IF;

  -- `estoque` e os campos de controle seguem livres de propósito: são
  -- consequência de venda, entrada e ajuste, cada um com a sua permissão.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produtos_permissao ON produtos;
CREATE TRIGGER trg_produtos_permissao
  BEFORE INSERT OR UPDATE OR DELETE ON produtos
  FOR EACH ROW EXECUTE FUNCTION produtos_checar_permissao();

-- ── Crédito de cliente ──────────────────────────────────────
--
-- Trava só o que é DECISÃO: limite e situação do crédito. Os saldos
-- (saldo_credito, saldo_devedor) continuam livres porque são resultado de
-- venda e pagamento — travá-los impediria o vendedor de vender no crediário,
-- que é justamente o que ele deve poder fazer.

CREATE OR REPLACE FUNCTION clientes_checar_permissao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.limite_credito IS DISTINCT FROM OLD.limite_credito
      OR NEW.status_credito IS DISTINCT FROM OLD.status_credito)
     AND NOT tem_permissao('editar_credito_cliente') THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar o crédito do cliente.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_permissao ON clientes;
CREATE TRIGGER trg_clientes_permissao
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION clientes_checar_permissao();

-- ============================================================
-- COMO DESFAZER, se algo travar indevidamente:
--
--   DROP TRIGGER IF EXISTS trg_produtos_permissao ON produtos;
--   DROP TRIGGER IF EXISTS trg_clientes_permissao ON clientes;
--
-- Os triggers não alteram dado nenhum — só recusam gravação. Removê-los
-- devolve o comportamento exatamente ao de antes.
-- ============================================================
