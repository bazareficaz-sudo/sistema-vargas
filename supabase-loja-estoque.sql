-- ============================================================
-- LOJA ONLINE — Fase 1: política de estoque do canal
--
-- Responde UMA pergunta, e é a única resposta autorizada para ela:
--
--     "quanto deste produto a loja pode vender agora?"
--
-- Antes disto o sistema não tinha essa resposta em lugar nenhum. Cada canal
-- calculava o seu jeito, e `empresa_config_estoque.reservar_em_pedido` existe
-- desde sempre sem nenhum código que o leia.
--
-- A conta:
--
--     físico            (conforme a política do canal)
--   − reservado         (estoque_reservas ativas)
--   − estoque_segurança (da loja, ou do produto)
--   = disponível
--
--     publicável        = min(disponível × percentual, máximo publicado)
--
-- `disponivel` é quanto EXISTE para vender. `publicavel` é quanto a vitrine
-- MOSTRA. São coisas diferentes de propósito: dá para ter 74 em estoque e
-- anunciar 10, sem mentir para o cliente e sem entregar o tamanho do estoque
-- ao concorrente.
--
-- Depende de supabase-loja-fundacao.sql. Aditivo; não altera nenhuma tabela
-- existente.
--
-- Execute no Supabase Dashboard → SQL Editor.
-- ============================================================


-- ============================================================
-- 1. Quais (empresa, depósito) entram na conta
--
-- Devolve os pares que a política da loja autoriza. `deposito_id` NULL
-- significa "todos os depósitos daquela empresa" — o mesmo significado que
-- `estoque_unificado_participantes` já usa.
--
-- IMPORTANTE — o modo `grupo_consolidado` NÃO inventa regra nova. Ele
-- reaproveita, inteira, a unificação de estoque que já existe e que já
-- alimenta os anúncios de marketplace:
--
--   empresa_config_estoque.estoque_unificado_ativo   → precisa estar ligada
--   estoque_unificado_participantes                  → quem entra na soma
--   empresa_config_estoque.estoque_unificado_deposito_id → o lado próprio
--
-- E acrescenta três travas que a versão de marketplace não fazia no banco:
-- mesmo tenant, mesmo grupo empresarial, e empresa ativa. Somar estoque de
-- outro CNPJ é sério demais para depender só de a tela ter perguntado certo.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_estoque_fontes(p_loja_id UUID)
RETURNS TABLE (empresa_id UUID, deposito_id UUID, proprio BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_modo    TEXT;
  v_dep     UUID;
  v_unif_ativo BOOLEAN;
  v_unif_dep   UUID;
  v_tenant  UUID;
  v_grupo   UUID;
BEGIN
  SELECT c.empresa_id, c.estoque_modo, c.estoque_deposito_id
    INTO v_empresa, v_modo, v_dep
    FROM loja_config c WHERE c.id = p_loja_id;

  IF v_empresa IS NULL THEN RETURN; END IF;

  IF v_modo = 'deposito_unico' THEN
    -- Depósito não configurado cai no principal ativo da empresa, em vez de
    -- devolver zero em silêncio — zero na vitrine inteira é o tipo de falha
    -- que ninguém percebe até um cliente reclamar.
    IF v_dep IS NULL THEN
      SELECT d.id INTO v_dep FROM depositos d
       WHERE d.empresa_id = v_empresa AND d.ativo AND d.principal
       ORDER BY d.created_at LIMIT 1;
    END IF;
    RETURN QUERY SELECT v_empresa, v_dep, true;
    RETURN;
  END IF;

  IF v_modo = 'depositos_selecionados' THEN
    RETURN QUERY
      SELECT led.empresa_id, led.deposito_id, true
        FROM loja_estoque_depositos led
        JOIN depositos d ON d.id = led.deposito_id AND d.ativo
       WHERE led.loja_id = p_loja_id
       ORDER BY led.ordem;
    RETURN;
  END IF;

  IF v_modo = 'empresa_consolidado' THEN
    -- NULL = soma todos os depósitos da empresa.
    RETURN QUERY SELECT v_empresa, NULL::UUID, true;
    RETURN;
  END IF;

  IF v_modo = 'grupo_consolidado' THEN
    SELECT ece.estoque_unificado_ativo, ece.estoque_unificado_deposito_id
      INTO v_unif_ativo, v_unif_dep
      FROM empresa_config_estoque ece WHERE ece.empresa_id = v_empresa;

    -- Lado próprio: exatamente o depósito que a unificação do ERP usa, para
    -- a loja e os marketplaces mostrarem o MESMO número.
    RETURN QUERY SELECT v_empresa, v_unif_dep, true;

    -- Unificação desligada = não soma ninguém. A loja fica com o estoque da
    -- própria empresa, e a tela avisa (ver loja_estoque_diagnostico).
    IF NOT COALESCE(v_unif_ativo, false) THEN RETURN; END IF;

    SELECT e.tenant_id, e.grupo_id INTO v_tenant, v_grupo
      FROM empresas e WHERE e.id = v_empresa;

    RETURN QUERY
      SELECT eup.participante_id, eup.deposito_id, false
        FROM estoque_unificado_participantes eup
        JOIN empresas ep ON ep.id = eup.participante_id
       WHERE eup.empresa_id = v_empresa
         AND ep.ativo
         AND ep.tenant_id IS NOT DISTINCT FROM v_tenant   -- nunca atravessa cliente da plataforma
         AND ep.grupo_id  IS NOT DISTINCT FROM v_grupo;   -- nem grupo empresarial
    RETURN;
  END IF;
END;
$$;

COMMENT ON FUNCTION loja_estoque_fontes(UUID) IS
  'Pares (empresa, depósito) autorizados pela política de estoque da loja. deposito_id NULL = todos os depósitos daquela empresa.';


-- ============================================================
-- 2. Diagnóstico — por que o número é esse
--
-- Existe para a tela de Estoque do painel poder mostrar a conta em vez de um
-- número mágico. É a diferença entre "disponível: 6" e "6 = 10 físicos − 2
-- reservados − 2 de segurança, no depósito Padrão".
-- ============================================================

CREATE OR REPLACE FUNCTION loja_estoque_diagnostico(p_loja_id UUID)
RETURNS TABLE (
  modo TEXT, fonte TEXT, empresa_nome TEXT, deposito_nome TEXT,
  proprio BOOLEAN, situacao TEXT, detalhe TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID; v_modo TEXT; v_fonte TEXT;
  v_unif_ativo BOOLEAN; v_tenant UUID; v_grupo UUID;
BEGIN
  SELECT c.empresa_id, c.estoque_modo, c.estoque_fonte
    INTO v_empresa, v_modo, v_fonte
    FROM loja_config c WHERE c.id = p_loja_id;
  IF v_empresa IS NULL THEN RETURN; END IF;

  -- Fontes que efetivamente contam.
  RETURN QUERY
    SELECT v_modo, v_fonte,
           COALESCE(e.nome_fantasia, e.nome),
           COALESCE(d.nome, 'todos os depósitos'),
           f.proprio,
           'contando'::TEXT,
           NULL::TEXT
      FROM loja_estoque_fontes(p_loja_id) f
      JOIN empresas e ON e.id = f.empresa_id
      LEFT JOIN depositos d ON d.id = f.deposito_id;

  IF v_modo <> 'grupo_consolidado' THEN RETURN; END IF;

  SELECT ece.estoque_unificado_ativo INTO v_unif_ativo
    FROM empresa_config_estoque ece WHERE ece.empresa_id = v_empresa;

  IF NOT COALESCE(v_unif_ativo, false) THEN
    RETURN QUERY SELECT v_modo, v_fonte, NULL::TEXT, NULL::TEXT, false, 'bloqueado'::TEXT,
      'A loja está em "estoque do grupo", mas a unificação de estoque da empresa está DESLIGADA em Empresas → Estoque. Nenhuma outra empresa está sendo somada.'::TEXT;
    RETURN;
  END IF;

  SELECT e.tenant_id, e.grupo_id INTO v_tenant, v_grupo FROM empresas e WHERE e.id = v_empresa;

  -- Participantes cadastrados que foram RECUSADOS, e o motivo. Silêncio aqui
  -- seria o pior resultado possível: o operador configurou, não funcionou, e
  -- não há nada para olhar.
  RETURN QUERY
    SELECT v_modo, v_fonte, COALESCE(ep.nome_fantasia, ep.nome, '(empresa removida)'),
           NULL::TEXT, false, 'recusado'::TEXT,
           CASE
             WHEN ep.id IS NULL              THEN 'Empresa participante não existe mais.'
             WHEN NOT ep.ativo               THEN 'Empresa participante está inativa.'
             WHEN ep.tenant_id IS DISTINCT FROM v_tenant THEN 'Participante é de outro tenant. Somar seria vazar estoque entre clientes da plataforma.'
             WHEN ep.grupo_id  IS DISTINCT FROM v_grupo  THEN 'Participante é de outro grupo empresarial.'
           END
      FROM estoque_unificado_participantes eup
      LEFT JOIN empresas ep ON ep.id = eup.participante_id
     WHERE eup.empresa_id = v_empresa
       AND (ep.id IS NULL OR NOT ep.ativo
            OR ep.tenant_id IS DISTINCT FROM v_tenant
            OR ep.grupo_id  IS DISTINCT FROM v_grupo);
END;
$$;


-- ============================================================
-- 3. A função principal — disponibilidade em lote
--
-- EM LOTE de propósito. Uma listagem de 24 produtos com uma chamada por
-- produto são 24 idas ao banco; é assim que uma vitrine fica lenta sem
-- ninguém entender por quê.
--
-- Devolve a conta ABERTA (físico, reservado, segurança) e não só o total,
-- porque a página do produto e o painel precisam explicar o número.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_estoque_disponivel(p_loja_id UUID, p_produto_ids UUID[])
RETURNS TABLE (
  produto_id  UUID,
  fisico      NUMERIC,
  reservado   NUMERIC,
  seguranca   NUMERIC,
  disponivel  NUMERIC,
  publicavel  NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa    UUID;
  v_modo       TEXT;
  v_fonte      TEXT;
  v_seg_loja   NUMERIC;
  v_percentual NUMERIC;
  v_max_loja   INTEGER;
BEGIN
  SELECT c.empresa_id, c.estoque_modo, c.estoque_fonte, c.estoque_seguranca,
         c.estoque_percentual_publicado, c.estoque_maximo_publicado
    INTO v_empresa, v_modo, v_fonte, v_seg_loja, v_percentual, v_max_loja
    FROM loja_config c WHERE c.id = p_loja_id;

  IF v_empresa IS NULL OR p_produto_ids IS NULL OR array_length(p_produto_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH alvo AS (
    SELECT DISTINCT unnest(p_produto_ids) AS pid
  ),
  fontes AS (
    SELECT f.empresa_id, f.deposito_id, f.proprio FROM loja_estoque_fontes(p_loja_id) f
  ),

  -- Produtos equivalentes nas empresas participantes. Só existe no modo
  -- grupo; nos outros o CTE fica vazio e não custa nada.
  --
  -- Três travas, todas obrigatórias:
  --   1. o vínculo pertence a uma parceria ATIVA;
  --   2. o produto do outro lado pertence de fato a uma empresa autorizada
  --      pela `fontes` (que já filtrou tenant, grupo e empresa ativa);
  --   3. DISTINCT, senão vínculo duplicado vira dupla contagem silenciosa.
  equivalentes AS (
    SELECT DISTINCT a.pid, v.outro, p.empresa_id AS emp_outro
      FROM alvo a
      JOIN LATERAL (
            SELECT pv.produto_id_b AS outro, pv.parceria_id
              FROM produto_vinculos pv WHERE pv.produto_id_a = a.pid
            UNION
            SELECT pv.produto_id_a, pv.parceria_id
              FROM produto_vinculos pv WHERE pv.produto_id_b = a.pid
           ) v ON true
      JOIN empresa_parcerias par ON par.id = v.parceria_id AND par.status = 'ativa'
      JOIN produtos p ON p.id = v.outro
     WHERE EXISTS (SELECT 1 FROM fontes f WHERE NOT f.proprio AND f.empresa_id = p.empresa_id)
  ),

  -- Todo produto que entra na soma, e a que "meu" produto ele responde.
  contados AS (
    SELECT a.pid, a.pid AS conta_pid, true AS proprio FROM alvo a
    UNION ALL
    SELECT e.pid, e.outro, false FROM equivalentes e
  ),

  -- Saldo físico de cada produto contado, respeitando a fonte configurada.
  saldo AS (
    SELECT c.pid,
           SUM(
             CASE
               -- `produtos.estoque`: o escalar. Não tem depósito, então vale
               -- uma vez por produto contado.
               WHEN v_fonte = 'produto_campo' THEN
                 COALESCE((SELECT pr.estoque FROM produtos pr WHERE pr.id = c.conta_pid), 0)
               ELSE
                 COALESCE((
                   SELECT SUM(pe.quantidade) FROM produto_estoque pe
                    WHERE pe.produto_id = c.conta_pid
                      AND EXISTS (
                        SELECT 1 FROM fontes f
                         WHERE f.proprio = c.proprio
                           AND (f.deposito_id IS NULL OR f.deposito_id = pe.deposito_id)
                           AND (f.deposito_id IS NOT NULL OR pe.empresa_id = f.empresa_id)
                      )
                 ), 0)
             END
           ) AS fisico
      FROM contados c
     GROUP BY c.pid
  ),

  -- Reservas ativas e ainda válidas, de QUALQUER canal — inclusive as do
  -- produto equivalente na empresa participante.
  reservas AS (
    SELECT c.pid, COALESCE(SUM(r.quantidade), 0) AS reservado
      FROM contados c
      LEFT JOIN estoque_reservas r
             ON r.produto_id = c.conta_pid
            AND r.status = 'ativa'
            AND (r.expira_em IS NULL OR r.expira_em > now())
     GROUP BY c.pid
  ),

  -- Segurança e teto: o produto sobrepõe a loja quando preenchido.
  regra AS (
    SELECT a.pid,
           COALESCE(lp.estoque_seguranca, v_seg_loja, 0) AS seguranca,
           COALESCE(lp.estoque_maximo_publicado, v_max_loja) AS maximo
      FROM alvo a
      LEFT JOIN loja_produtos lp ON lp.loja_id = p_loja_id AND lp.produto_id = a.pid
  )

  SELECT a.pid,
         COALESCE(s.fisico, 0),
         COALESCE(rs.reservado, 0),
         g.seguranca,
         GREATEST(0, COALESCE(s.fisico, 0) - COALESCE(rs.reservado, 0) - g.seguranca) AS disp,
         LEAST(
           -- Percentual: floor, nunca round. Arredondar para cima anuncia o
           -- que não existe, que é exatamente o que a política quer evitar.
           floor(GREATEST(0, COALESCE(s.fisico, 0) - COALESCE(rs.reservado, 0) - g.seguranca)
                 * COALESCE(v_percentual, 100) / 100.0),
           COALESCE(g.maximo, 2147483647)
         ) AS publ
    FROM alvo a
    LEFT JOIN saldo    s  ON s.pid  = a.pid
    LEFT JOIN reservas rs ON rs.pid = a.pid
    JOIN      regra    g  ON g.pid  = a.pid;
END;
$$;

COMMENT ON FUNCTION loja_estoque_disponivel(UUID, UUID[]) IS
  'Única resposta autorizada para "quanto a loja pode vender". Em lote. Devolve a conta aberta.';


-- ============================================================
-- 4. Expiração de reservas
--
-- A tabela nasce vazia e a Fase 1 não escreve nela. A rotina entra agora
-- porque uma reserva que não expira é pior que não ter reserva: some do
-- estoque para sempre, e ninguém liga uma coisa à outra meses depois.
--
-- Chamada por cron (ver /api/cron/loja-manutencao).
-- ============================================================

CREATE OR REPLACE FUNCTION loja_expirar_reservas()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE estoque_reservas
     SET status = 'expirada', encerrado_em = now()
   WHERE status = 'ativa' AND expira_em IS NOT NULL AND expira_em <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;


-- ============================================================
-- 4b. Divergência entre as duas fontes de saldo
--
-- O ERP tem `produtos.estoque` (escalar) e `produto_estoque` (por depósito),
-- e elas divergem: 540 produtos medidos em 14/08 e registrados no
-- CONTINUIDADE.md. A causa já foi corrigida; a sujeira acumulada não.
--
-- A loja escolhe UMA das duas em `loja_config.estoque_fonte`. Esta função põe
-- o tamanho do problema na tela, ao lado da escolha, para ela ser uma decisão
-- informada em vez de um campo que ninguém sabe o que faz.
-- ============================================================

CREATE OR REPLACE FUNCTION loja_divergencia_estoque(p_loja_id UUID)
RETURNS TABLE (publicados BIGINT, divergentes BIGINT, sem_linha_deposito BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_empresa UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM loja_config WHERE id = p_loja_id;
  IF v_empresa IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pub AS (
    SELECT lp.produto_id, p.estoque AS campo
      FROM loja_produtos lp
      JOIN produtos p ON p.id = lp.produto_id
     WHERE lp.loja_id = p_loja_id AND lp.status = 'publicado'
  ),
  dep AS (
    SELECT pub.produto_id, pub.campo,
           (SELECT SUM(pe.quantidade) FROM produto_estoque pe
             WHERE pe.produto_id = pub.produto_id AND pe.empresa_id = v_empresa) AS soma
      FROM pub
  )
  SELECT count(*),
         count(*) FILTER (WHERE soma IS NOT NULL AND COALESCE(campo, 0) <> soma),
         count(*) FILTER (WHERE soma IS NULL)
    FROM dep;
END;
$$;


-- ============================================================
-- 5. Privilégios
--
-- NADA para `anon`. A vitrine pública não fala com o banco: quem chama estas
-- funções é o servidor, com chave de serviço. `authenticated` recebe porque
-- o painel do ERP precisa (tela de Estoque e prévia de publicação), e lá a
-- sessão é de um usuário real com RLS.
-- ============================================================

REVOKE ALL ON FUNCTION loja_estoque_fontes(UUID)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_estoque_diagnostico(UUID)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_estoque_disponivel(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_expirar_reservas()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION loja_divergencia_estoque(UUID)       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION loja_estoque_fontes(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION loja_estoque_diagnostico(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION loja_estoque_disponivel(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION loja_divergencia_estoque(UUID)        TO authenticated;


-- ============================================================
-- CONFERÊNCIA
--
--   -- de onde vem o estoque desta loja:
--   SELECT * FROM loja_estoque_diagnostico('<loja_id>');
--
--   -- a conta aberta de alguns produtos:
--   SELECT * FROM loja_estoque_disponivel('<loja_id>',
--     ARRAY(SELECT produto_id FROM loja_produtos WHERE loja_id='<loja_id>' LIMIT 10));
--
--   -- nenhuma função pode estar liberada para anon:
--   SELECT p.proname FROM pg_proc p
--    WHERE p.proname LIKE 'loja_%'
--      AND has_function_privilege('anon', p.oid, 'EXECUTE');
--   -- esperado: ZERO linhas
-- ============================================================

-- ============================================================
-- COMO DESFAZER
--   DROP FUNCTION IF EXISTS loja_estoque_disponivel(UUID, UUID[]);
--   DROP FUNCTION IF EXISTS loja_estoque_diagnostico(UUID);
--   DROP FUNCTION IF EXISTS loja_estoque_fontes(UUID);
--   DROP FUNCTION IF EXISTS loja_expirar_reservas();
-- Nenhum dado é alterado por este arquivo.
-- ============================================================
