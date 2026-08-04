-- ═══════════════════════════════════════════════════════════════════════════
--  Bazar Eficaz sem assinatura + módulo entradas_xml fora dos planos
--  Rodar no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════════════
--
--  SINTOMA: a Eliane (papel Financeiro) não via PDV nem Contas a Receber, mesmo
--  com as duas telas liberadas nas permissões dela.
--
--  CAUSA: a empresa Bazar Eficaz não tem linha em `subscriptions`. Sem
--  assinatura, loadPlanData cai no plano de emergência e entrega só
--  dashboard, produtos, clientes, vendas e relatorios. O dono nunca percebeu
--  porque é system admin, e `temModulo()` libera tudo para system admin antes
--  de olhar o plano — o problema só aparece para usuário comum.

-- ── 1. Ver o estado antes ────────────────────────────────────────────────────
SELECT e.nome AS empresa,
       COALESCE(p.nome, '— SEM ASSINATURA —') AS plano,
       s.status
FROM empresas e
LEFT JOIN subscriptions s ON s.empresa_id = e.id
LEFT JOIN plans p ON p.id = s.plan_id
ORDER BY e.nome;

-- ── 2. Criar a assinatura da Bazar Eficaz no plano Enterprise ────────────────
-- Enterprise é o plano com todos os 30 módulos. `ON CONFLICT` protege contra
-- rodar duas vezes: empresa_id é UNIQUE em subscriptions.
INSERT INTO subscriptions (empresa_id, plan_id, status, data_inicio, trial_inicio, trial_fim, observacoes)
SELECT
  e.id,
  (SELECT id FROM plans WHERE codigo = 'enterprise'),
  'active',
  CURRENT_DATE,
  CURRENT_DATE,
  NULL,
  'Assinatura criada manualmente — a empresa é anterior ao fluxo de cadastro que cria a assinatura sozinho.'
FROM empresas e
WHERE e.nome = 'Bazar Eficaz'
ON CONFLICT (empresa_id) DO NOTHING;

-- ── 3. entradas_xml não está em nenhum plano além do Fiscal ──────────────────
-- Quando "Entrada por XML" virou um módulo separado de "Entradas", ele não foi
-- incluído nos planos que já existiam. Resultado: as telas de entrada por XML
-- ficam escondidas para todo usuário comum, em qualquer plano, inclusive na
-- Ouro e Prata (que é Enterprise). Só o Fiscal recebeu o módulo, porque foi
-- criado depois.
INSERT INTO plan_modules (plan_id, modulo)
SELECT id, 'entradas_xml' FROM plans WHERE codigo IN ('enterprise', 'professional')
ON CONFLICT DO NOTHING;

-- Starter e Balcão têm "entradas" (manual) mas não "entradas_xml". Incluir ou
-- não é decisão de produto, não técnica — antes da separação, quem tinha
-- "entradas" enxergava a entrada por XML junto. Para devolver esse
-- comportamento, tire o comentário das duas linhas abaixo.
-- INSERT INTO plan_modules (plan_id, modulo)
-- SELECT id, 'entradas_xml' FROM plans WHERE codigo IN ('starter', '001') ON CONFLICT DO NOTHING;

-- ── 4. Conferir o resultado ──────────────────────────────────────────────────
SELECT e.nome AS empresa, p.nome AS plano, s.status,
       (SELECT count(*) FROM plan_modules pm WHERE pm.plan_id = p.id) AS modulos
FROM empresas e
JOIN subscriptions s ON s.empresa_id = e.id
JOIN plans p ON p.id = s.plan_id
ORDER BY e.nome;
