-- Seletor de empresa — fatia 2: a permissão sai da interface e vai para o banco.
--
-- ESTADO DE HOJE, medido: as políticas usam `empresa_do_meu_grupo()`, que
-- aceita QUALQUER empresa do mesmo tenant. Ou seja, um usuário do Bazar
-- Eficaz já pode ler e gravar dados do BAZAR OURO E PRATA — o que o segura
-- numa empresa só é a interface, não o banco.
--
-- Este arquivo faz três coisas, nesta ordem (a ordem importa: inverter
-- tranca todo mundo para fora):
--   1. Popula `usuario_empresas` com o que já existe hoje.
--   2. Protege a própria `usuario_empresas`.
--   3. Só então aperta `empresa_do_meu_grupo()`.
--
-- Depois deste script o acesso fica MENOR do que era: cada usuário passa a
-- alcançar a própria empresa e as que estiverem escritas em
-- `usuario_empresas`, e nada além disso.

-- ── 1. Popular a partir do que já existe ────────────────────
--
-- Cada usuário ganha a empresa do próprio cadastro, marcada como padrão. O
-- papel vem do `role` do perfil, traduzido para os valores que a tabela
-- aceita; o que não casar vira 'operador', que é o menos privilegiado dos
-- papéis operacionais.
INSERT INTO usuario_empresas (user_id, empresa_id, perfil, empresa_padrao, ativo)
SELECT
  p.id,
  p.empresa_id,
  CASE
    WHEN p.role IN ('admin','gerente','operador','financeiro','estoque','leitura') THEN p.role
    WHEN p.role = 'dono'  THEN 'admin'
    WHEN p.role = 'caixa' THEN 'operador'
    ELSE 'operador'
  END,
  true,
  true
FROM profiles p
WHERE p.empresa_id IS NOT NULL
ON CONFLICT (user_id, empresa_id) DO NOTHING;

-- ── 2. Proteger a tabela ────────────────────────────────────
--
-- O usuário enxerga os PRÓPRIOS vínculos (é disso que o seletor se alimenta)
-- e não escreve nada: conceder acesso a outra empresa é ato de administração,
-- feito com a chave de serviço. Sem esta política, quem quisesse acesso a
-- outra empresa bastaria inserir a própria linha.
ALTER TABLE usuario_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meus_vinculos_leitura" ON usuario_empresas;
CREATE POLICY "meus_vinculos_leitura" ON usuario_empresas
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_system_admin());

DROP POLICY IF EXISTS "vinculos_admin" ON usuario_empresas;
CREATE POLICY "vinculos_admin" ON usuario_empresas
  FOR ALL TO authenticated
  USING (is_system_admin()) WITH CHECK (is_system_admin());

-- ── 3. Apertar a função de acesso ───────────────────────────
--
-- Antes: qualquer empresa do tenant. Agora: a própria empresa do cadastro
-- (sempre, para ninguém ficar trancado do lado de fora nem que a tabela
-- esteja incompleta) mais as concedidas explicitamente.
--
-- O nome da função continua o mesmo de propósito: ela é citada em dezenas de
-- políticas já criadas, e renomear obrigaria a reescrever todas.
CREATE OR REPLACE FUNCTION empresa_do_meu_grupo(p_empresa UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_empresa = minha_empresa_id()
      OR EXISTS (
        SELECT 1 FROM usuario_empresas ue
        WHERE ue.user_id = auth.uid()
          AND ue.empresa_id = p_empresa
          AND ue.ativo
      );
$$;

GRANT EXECUTE ON FUNCTION empresa_do_meu_grupo(UUID) TO authenticated;

-- ── Conferência ─────────────────────────────────────────────
-- Rode depois para ver quem alcança o quê:
--
--   SELECT u.email, e.nome_fantasia, ue.perfil, ue.empresa_padrao
--   FROM usuario_empresas ue
--   JOIN auth.users u ON u.id = ue.user_id
--   JOIN empresas e   ON e.id = ue.empresa_id
--   ORDER BY u.email;
--
-- Para dar a um usuário acesso à segunda empresa (é isto que habilita o
-- seletor para ele):
--
--   INSERT INTO usuario_empresas (user_id, empresa_id, perfil, ativo)
--   VALUES ('<user_id>', '<empresa_id>', 'admin', true)
--   ON CONFLICT (user_id, empresa_id) DO UPDATE SET ativo = true, perfil = EXCLUDED.perfil;
