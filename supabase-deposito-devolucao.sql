-- Depósito padrão para onde vai o estoque das devoluções de venda (PDV).
alter table empresa_config_estoque
  add column if not exists deposito_devolucao_id uuid references depositos(id);
