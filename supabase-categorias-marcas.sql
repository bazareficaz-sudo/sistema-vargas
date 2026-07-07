-- Categorias (suporta hierarquia: categoria / subcategoria)
CREATE TABLE IF NOT EXISTS categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID REFERENCES empresas(id),
  nome        TEXT NOT NULL,
  pai_id      UUID REFERENCES categorias(id),  -- NULL = categoria raiz
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Marcas
CREATE TABLE IF NOT EXISTS marcas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID REFERENCES empresas(id),
  nome        TEXT NOT NULL,
  ativo       BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Desabilitar RLS (dev)
ALTER TABLE categorias DISABLE ROW LEVEL SECURITY;
ALTER TABLE marcas     DISABLE ROW LEVEL SECURITY;

-- Popular marcas e categorias a partir dos dados existentes em produtos
INSERT INTO marcas (empresa_id, nome)
SELECT DISTINCT 'a1000000-0000-0000-0000-000000000001'::uuid, marca
FROM produtos
WHERE marca IS NOT NULL AND marca <> ''
ON CONFLICT DO NOTHING;

INSERT INTO categorias (empresa_id, nome)
SELECT DISTINCT 'a1000000-0000-0000-0000-000000000001'::uuid, categoria
FROM produtos
WHERE categoria IS NOT NULL AND categoria <> ''
ON CONFLICT DO NOTHING;
