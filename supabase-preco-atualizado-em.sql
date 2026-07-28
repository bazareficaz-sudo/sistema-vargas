-- Rastreia quando o preço (custo ou venda) de um produto foi realmente
-- alterado — updated_at é compartilhado com qualquer edição do cadastro,
-- então não serve pra filtrar "produtos com preço desatualizado há X dias"
-- na tela de Gestão de Preços. NULL = nunca teve o preço alterado por um
-- dos caminhos que gravam este campo (histórico anterior a esta coluna
-- não é preenchido retroativamente).
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_atualizado_em TIMESTAMPTZ;
