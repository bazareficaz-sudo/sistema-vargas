-- Corrige 30 itens de venda órfãos (produto_id inválido, herdado do
-- app desktop do PDV) reconectando cada um ao produto real por SKU exato,
-- dentro da mesma empresa. Gerado automaticamente — cada linha já foi
-- conferida (SKU bate com exatamente 1 produto).

UPDATE venda_itens vi
SET produto_id = fix.produto_correto::uuid
FROM (VALUES
  ('4864bbeb-099d-4211-bf39-0e59bedac67c', 'f589eca0-79ba-4922-8908-22d0415671d4'),
  ('7b5b0702-f96f-4ffb-b16d-872fe41f76d1', 'f589eca0-79ba-4922-8908-22d0415671d4'),
  ('572b13e2-9fb8-4cc8-9a21-714d30367204', '453ef3b1-8028-4d32-8688-e47346ed0010'),
  ('ec3bc2be-d6d5-43d4-94b5-5e2d959bae5f', '2c4237b5-6c9f-42cd-8a91-2a90f3190713'),
  ('cb2596dc-bf4e-419a-8dc0-cd3b6b08d660', 'feb81d7c-9bb6-4d4c-94d4-84e54e11ea56'),
  ('f71b370c-bc06-447f-a362-b3eb8acccd4b', 'f3aa9887-25b9-42b3-aadd-2f51195f3843'),
  ('8096f96b-3e62-444f-bc1b-5ba51f1afa53', 'ca972ff2-fbdf-45c0-8b64-14076eecb321'),
  ('01ca3795-51d6-4158-a616-f607e1286037', '410cd812-5a3d-41ff-983a-2b6bb5fb66ac'),
  ('19745249-8607-43af-8aa4-6c81746b6b7a', 'd079d411-f633-4c23-963a-2fe48a39dbe7'),
  ('3597f4c0-fccf-43e3-801d-fa8c38e88da3', 'a5e8c341-49f9-4e4f-a7c1-d43059baa662'),
  ('d4dd3ac9-a152-4fbc-9434-29a6755b473d', 'a5e8c341-49f9-4e4f-a7c1-d43059baa662'),
  ('2f386186-8120-4ecf-a0a7-59f25fd7cc1f', 'da3ef129-5f5c-4873-a833-c10c909d9898'),
  ('d802de39-1a5e-4522-9436-5b4955dff8d8', '3e275a38-d025-4e05-af4b-cd5b7e6a34e5'),
  ('fe32b5bb-410e-457b-9c29-3f9035e0ba59', 'feb81d7c-9bb6-4d4c-94d4-84e54e11ea56'),
  ('85b6ab74-c363-42fe-a4e0-59850deea504', '617e993a-6f46-4b08-ae99-89bf34873dca'),
  ('6582a4ff-2e6e-4aee-ab87-7b37b8b63a69', '66689a80-7a77-4007-b2fd-cc094ca5dc3e'),
  ('0be85a09-95a9-4b87-9a54-2e6a066a3c15', 'a8e3be53-c416-43f8-a68e-3f496e2ccaae'),
  ('3c61c604-aead-4723-a525-c99bb98e8139', 'e9678470-3efb-4d36-a91e-0133c0f787e2'),
  ('2a568208-f11f-42f6-b627-676cc7a9f58b', '9f7f0a1e-1c7b-492b-a1a6-eb1114ceec8d'),
  ('be86688f-336e-4f95-8de5-edef5a46e679', '8f61f3ee-5096-45d4-893e-fc9e161be073'),
  ('5dcbd6bb-ca5b-4c11-845f-cb0f2d44bb7c', 'e9678470-3efb-4d36-a91e-0133c0f787e2'),
  ('71d21be5-b464-43a5-a89e-9f1492e8d4c4', '699d3dee-4fc0-45ac-aa49-9c7195d78775'),
  ('8f5fb8c2-6dc5-4558-9177-ac70a64c0e1e', '325427f8-f36b-4f02-8cfc-46cc34aca490'),
  ('dbe033a8-18fe-4b93-a7e9-50f3eb323052', '2edeba37-cf10-4f07-b036-e50b564b33f9'),
  ('f7ffa9b5-eebd-40c2-bb29-51fe9c91a1b9', '3607cc96-7e4a-478e-95c9-f516833e7348'),
  ('e1d5eaff-06a0-4f4b-9d26-954f509bfdc3', 'cefeabb7-cfc2-49c6-a6bd-7235d18a6f53'),
  ('8d998bc8-9d5c-4ffa-b32a-ee3949f931b0', '2bb4b2b9-24ae-4a65-a450-5d8ca63e1177'),
  ('7c740a88-35d1-4812-b516-3adfa07ea5bb', '79c7cbf7-56c2-4500-a9eb-c7b68e48673d'),
  ('b1d8f362-6452-420f-96ea-90a83bca9dd7', '325427f8-f36b-4f02-8cfc-46cc34aca490'),
  ('85c8e338-bb46-4fbc-a2e7-b15f96cdfd90', 'c4025be2-da75-4b7f-b8a4-0c065cb8dab4')
) AS fix(item_id, produto_correto)
WHERE vi.id = fix.item_id::uuid;
