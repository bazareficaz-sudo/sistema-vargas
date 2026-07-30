-- Cadastra os fornecedores que só existiam dentro das entradas por XML.
--
-- As 9 entradas em nfe_entradas guardavam o fornecedor apenas desnormalizado
-- (cnpj_fornecedor/nome_fornecedor) com fornecedor_id NULL — nenhuma delas
-- criou cadastro em fornecedores. Os dados abaixo (razão social, fantasia,
-- IE, endereço, telefone) foram extraídos do bloco <emit> do próprio XML
-- guardado em nfe_entradas.xml_content, não digitados à mão.
--
-- Os 8 fornecedores que já existiam são cadastros manuais sem CNPJ e não
-- correspondem a nenhum destes 5 (conferido por CNPJ e por semelhança de
-- nome). O INSERT é idempotente: rodar de novo não duplica.

-- DIME COMERCIO IMPORTACAO E EXPORTACAO LTDA. — NFs 1866971, 1871993, 1873443, 1874873, 1875614
INSERT INTO fornecedores (empresa_id, razao_social, nome_fantasia, cnpj, ie, telefone, endereco, numero, complemento, bairro, cidade, estado, cep, observacoes, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001', 'DIME COMERCIO IMPORTACAO E EXPORTACAO LTDA.', 'DIME DISTRIBUIDORA', '04286673000100', '77141995', '2135412400',
       'AVENIDA DE SANTA CRUZ', '10245', NULL, 'SANTISSIMO', 'Rio de Janeiro', 'RJ', '23010175',
       'Cadastrado a partir da NF-e de entrada (XML)', true
WHERE NOT EXISTS (
  SELECT 1 FROM fornecedores WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001' AND regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = '04286673000100'
);

-- COFEOS FERRAGENS LTDA — NFs 709876
INSERT INTO fornecedores (empresa_id, razao_social, nome_fantasia, cnpj, ie, telefone, endereco, numero, complemento, bairro, cidade, estado, cep, observacoes, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001', 'COFEOS FERRAGENS LTDA', 'COFEOS FERRAGENS LTDA', '07292260000127', '77890823', '08007005500',
       'R CAPITAO JUVENAL FIGUEIREDO', '1485', 'GALPAO;', 'TRIBOBO', 'Sao Goncalo', 'RJ', '24750565',
       'Cadastrado a partir da NF-e de entrada (XML)', true
WHERE NOT EXISTS (
  SELECT 1 FROM fornecedores WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001' AND regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = '07292260000127'
);

-- FERRAGENS RAMADA LTDA — NFs 1689233
INSERT INTO fornecedores (empresa_id, razao_social, nome_fantasia, cnpj, ie, telefone, endereco, numero, complemento, bairro, cidade, estado, cep, observacoes, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001', 'FERRAGENS RAMADA LTDA', 'RAMADA (MATRIZ)', '30290688000152', '82103856', '02124724848',
       'RUA PEDRO JORIO', '365', NULL, 'COELHO NETO', 'RIO DE JANEIRO', 'RJ', '21530030',
       'Cadastrado a partir da NF-e de entrada (XML)', true
WHERE NOT EXISTS (
  SELECT 1 FROM fornecedores WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001' AND regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = '30290688000152'
);

-- VOTORANTIM CIMENTOS SA — NFs 176974
INSERT INTO fornecedores (empresa_id, razao_social, nome_fantasia, cnpj, ie, telefone, endereco, numero, complemento, bairro, cidade, estado, cep, observacoes, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001', 'VOTORANTIM CIMENTOS SA', 'VC - CD RIO', '01637895023930', '11520324', '08007019894',
       'AVENIDA BRASIL', '16469', NULL, 'PARADA DE LUCAS', 'RIO DE JANEIRO', 'RJ', '21241051',
       'Cadastrado a partir da NF-e de entrada (XML)', true
WHERE NOT EXISTS (
  SELECT 1 FROM fornecedores WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001' AND regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = '01637895023930'
);

-- CASA CARDAO LTDA — NFs 1097573
INSERT INTO fornecedores (empresa_id, razao_social, nome_fantasia, cnpj, ie, telefone, endereco, numero, complemento, bairro, cidade, estado, cep, observacoes, ativo)
SELECT 'a1000000-0000-0000-0000-000000000001', 'CASA CARDAO LTDA', 'CASA CARDAO LTDA', '32287542000183', '80825943', '2422444800',
       'RUA AMARAL PEIXOTO', '910', '910', 'AFONSO ARINOS', 'COMENDADOR LEVY GASPARIAN', 'RJ', '25875000',
       'Cadastrado a partir da NF-e de entrada (XML)', true
WHERE NOT EXISTS (
  SELECT 1 FROM fornecedores WHERE empresa_id = 'a1000000-0000-0000-0000-000000000001' AND regexp_replace(COALESCE(cnpj, ''), '\D', '', 'g') = '32287542000183'
);

-- Vincula as entradas ao fornecedor recém-cadastrado (fornecedor_id
-- estava NULL em todas). Só preenche o que está vazio, casando por
-- empresa + CNPJ.
UPDATE nfe_entradas e
SET fornecedor_id = f.id,
    updated_at = now()
FROM fornecedores f
WHERE e.fornecedor_id IS NULL
  AND f.empresa_id = e.empresa_id
  AND regexp_replace(COALESCE(f.cnpj, ''), '\D', '', 'g') = regexp_replace(COALESCE(e.cnpj_fornecedor, ''), '\D', '', 'g')
  AND COALESCE(e.cnpj_fornecedor, '') <> '';

-- Confere o resultado
SELECT e.numero AS nf,
       e.nome_fornecedor AS nome_no_xml,
       f.razao_social AS fornecedor_vinculado,
       f.cnpj
FROM nfe_entradas e
LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
ORDER BY f.razao_social NULLS FIRST, e.numero;
