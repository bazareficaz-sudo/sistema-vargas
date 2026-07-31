-- Permissões ajustáveis por usuário.
--
-- Até aqui o sistema tinha 6 papéis fixos, escritos em código: o gestor
-- escolhia "Vendas" ou "Financeiro" e herdava o pacote inteiro daquele papel,
-- sem poder tirar um item específico ("pode vender, mas não vê faturamento").
--
-- Esta tabela guarda EXCEÇÕES em cima do papel — uma linha só quando o gestor
-- liga ou desliga algo diferente do padrão. Quem não tem nenhuma linha aqui
-- continua exatamente com o pacote do papel dele.
--
-- Fica no banco (e não só no código) de propósito: o aplicativo do celular lê
-- daqui também, então a regra é a mesma nos dois lugares em vez de cada um ter
-- a sua cópia.

CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,
  -- true  = libera algo que o papel não dava
  -- false = bloqueia algo que o papel dava
  permitido      BOOLEAN NOT NULL,
  atualizado_por UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_usuario ON usuario_permissoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_permissoes_empresa ON usuario_permissoes(empresa_id);

ALTER TABLE usuario_permissoes ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga as próprias permissões (é assim que o app do celular
-- descobre o que pode mostrar). Escrita é só pela rota de servidor, que usa
-- a service role e confirma que quem chama tem 'gerenciar_usuarios'.
DROP POLICY IF EXISTS "usuario_permissoes_select_proprias" ON usuario_permissoes;
CREATE POLICY "usuario_permissoes_select_proprias" ON usuario_permissoes
  FOR SELECT USING (usuario_id = auth.uid());
