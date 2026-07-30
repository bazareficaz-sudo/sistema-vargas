-- Preferências de impressão do comprovante/cupom, por empresa.
-- Mesmo padrão das outras empresa_config_* (uma linha por empresa,
-- empresa_id UNIQUE, sem RLS própria — isolamento por empresa_id na
-- aplicação, como no resto do schema de negócio).

CREATE TABLE IF NOT EXISTS empresa_config_impressao (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,

  -- a4: folha comum. bobina_80/bobina_58: impressora térmica (largura em mm).
  formato           TEXT NOT NULL DEFAULT 'a4' CHECK (formato IN ('a4', 'bobina_80', 'bobina_58')),

  -- Mensagem que fecha o cupom ("Obrigado pela preferência!", trocas, etc.)
  mensagem_rodape   TEXT,

  -- Em bobina o espaço é curto; o SKU costuma atrapalhar mais que ajudar.
  mostrar_sku       BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE empresa_config_impressao DISABLE ROW LEVEL SECURITY;

-- Empresa sem linha aqui usa o padrão do código (A4, sem mensagem), então
-- não é obrigatório popular nada — mas já deixa criado pras existentes.
INSERT INTO empresa_config_impressao (empresa_id)
SELECT id FROM empresas
ON CONFLICT (empresa_id) DO NOTHING;

SELECT e.nome, ci.formato, ci.mensagem_rodape, ci.mostrar_sku
FROM empresa_config_impressao ci
JOIN empresas e ON e.id = ci.empresa_id
ORDER BY e.nome;
