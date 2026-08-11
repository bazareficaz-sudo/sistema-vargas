-- Corrige o venda_itens órfão da venda #301000: o produto_id gravado
-- ("6a03321c4ab90ddc36e6cba1") é o id local do app desktop do PDV, não um
-- UUID do Supabase — por isso a emissão de NFC-e não achava o NCM. Reponta
-- pro produto real com mesmo SKU (17357) já cadastrado no sistema.
UPDATE venda_itens
SET produto_id = 'c6b490e0-f8f3-40bb-9a8d-33802de9241f'
WHERE venda_id = '99603e2b-a163-4827-bbe2-da96f6211a41'
  AND produto_sku = '17357';
