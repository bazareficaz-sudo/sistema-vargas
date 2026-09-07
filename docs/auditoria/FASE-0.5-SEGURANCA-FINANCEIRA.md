# Fase 0.5 — Segurança financeira e isolamento multiempresa

**Data:** 06/09/2026
**Projeto:** `ntwfkmwprjciucydedku` — "Sistema Vargas", região sa-east-1,
Postgres 17.6.1.127, `ACTIVE_HEALTHY`. **Único projeto da organização; não há
branch nem ambiente de staging** (`list_branches` → vazio). Toda alteração vai
direto para produção, com a loja operando.

---

## A. Estado anterior

### RLS e policies

| Tabela | RLS antes | Policies | Padrão |
|---|---|---|---|
| `vendas` | ❌ desligada | 0 | — |
| `venda_itens` | ❌ desligada | 0 | — |
| `contas_receber` | ❌ desligada | 0 | — |
| `recebimentos` | ❌ desligada | 0 | — |
| `creditos_cliente` | ❌ desligada | 0 | — |
| `credito_utilizacoes` | ❌ desligada | 0 | — |
| `renegociacoes` | ❌ desligada | 0 | — |
| `cr_auditoria` | ❌ desligada | 0 | — |
| `clientes` | ❌ desligada | 0 | — |
| `contas_pagar` | ✅ ligada | 1 | `empresa_id IN (SELECT empresa_id FROM profiles WHERE id = auth.uid()) OR is_system_admin()` |
| `empresa_auditoria` | ✅ ligada | 1 | `empresa_do_meu_grupo(empresa_id) OR is_system_admin()` |
| `system_admins` | ❌ **desligada, com 3 policies escritas** | 3 | as policies não se aplicam |

O advisor de segurança do Supabase reporta **97 tabelas** com
`rls_disabled_in_public` (nível ERROR) e 1 `policy_exists_rls_disabled`
(`system_admins`).

### Grants do `anon` (antes)

| Tabela | `anon` podia |
|---|---|
| `contas_pagar` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| `recebimentos` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| `creditos_cliente` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE |
| `contas_receber` | SELECT, INSERT, UPDATE, TRUNCATE |
| `clientes` | SELECT, INSERT, UPDATE, TRUNCATE |
| `vendas` | SELECT, INSERT, TRUNCATE |
| `venda_itens` | SELECT, INSERT, TRUNCATE |

### Grants do `authenticated` em `system_admins` (antes)

SELECT, **INSERT, UPDATE, DELETE, TRUNCATE**.

### Escritores — medição de 24h nos logs de produção

Chave usada: `request.sb.jwt.authorization.payload.role` e
`request.sb.auth_user` em `edge_logs`.

| Caminho | Método | Papel | Requisições | Com usuário autenticado |
|---|---|---|---|---|
| `/rest/v1/vendas` | POST | **anon** | 99 | **0** |
| `/rest/v1/venda_itens` | POST | **anon** | 98 | **0** |
| `/rest/v1/recebimentos` | POST | **anon** | 23 | **0** |
| `/rest/v1/contas_receber` | PATCH | **anon** | 23 | **0** |
| `/rest/v1/vendas` | POST | authenticated | 5 | 5 |
| `/rest/v1/venda_itens` | POST | authenticated | 5 | 5 |
| `/rest/v1/contas_pagar` | POST | authenticated | 1 | 1 |
| `/rest/v1/clientes` | PATCH | authenticated | 1 | 1 |
| `/rest/v1/rpc/autenticar_operador_pdv` | POST | — | 5 | — |

Nenhum DELETE e nenhum TRUNCATE do `anon` em qualquer tabela financeira na
janela. De 258.810 requisições no período, apenas 3.802 carregam
`request.sb.auth_user`.

### Escritores no código (painel web)

Todo o financeiro do painel escreve **direto do navegador**, com
`createClient()` do lado do cliente, sem rota de API:

| Arquivo | Função | Tabela | Ambiente | Depende de |
|---|---|---|---|---|
| `src/components/contas-pagar/PagarContasModal.tsx` | `confirmar()` | `contas_pagar` UPDATE | navegador | usuário autenticado |
| `src/components/contas-receber/ContasReceberClient.tsx` | recebimento | `recebimentos` INSERT, `contas_receber` UPDATE, `creditos_cliente` UPDATE | navegador | usuário autenticado |
| `src/components/contas-receber/ReceberEmMassaModal.tsx` | — | `recebimentos` INSERT | navegador | usuário autenticado |
| `src/components/pdv/PDVClient.tsx` | `concluirVenda()` | `vendas`, `venda_itens`, `produtos`, `produto_estoque`, `contas_receber`, `creditos_cliente` | navegador | usuário autenticado |
| `src/app/api/vendas/[id]/editar/route.ts` | POST | `vendas`, `venda_itens`, `produtos` | **servidor** | `exigirPermissao('cancelar_venda')` |
| `src/app/api/vendas/[id]/cancelar/route.ts` | POST | `vendas`, `contas_receber`, `creditos_cliente`, `clientes` | **servidor** | `exigirPermissao('cancelar_venda')` |
| gatilho `trg_venda_carteira` | `criar_conta_carteira()` | `contas_receber` INSERT | banco, `AFTER INSERT ON vendas` | — |

Existem exatamente **duas** rotas de servidor financeiras, ambas criadas nos
últimos dias. Todo o resto é navegador.

---

## B. Riscos encontrados

### CRÍTICO

**R1 — Escalação de privilégio via `system_admins`.**
RLS desligada + `authenticated` com INSERT. `is_system_admin()` é a cláusula
de escape de ~40 policies (`... OR is_system_admin()`). Qualquer usuário
autenticado — um balconista com login — podia inserir o próprio `auth.uid()`
e passar a ler e alterar os dados de **todas as empresas de todos os
tenants**. *Corrigido nesta fase.*

**R2 — `anon` com escrita no financeiro e RLS desligada.**
A chave anônima, que viaja dentro do JavaScript público, podia apagar
(`DELETE`) e esvaziar (`TRUNCATE`) `contas_pagar`, `recebimentos` e
`creditos_cliente`. *Parcialmente corrigido: DELETE e TRUNCATE fechados;
INSERT e UPDATE permanecem por dependência do PDV externo.*

### ALTO

**R3 — Sem isolamento por empresa nas tabelas financeiras centrais.**
Com RLS desligada em `vendas`, `contas_receber`, `recebimentos` e `clientes`,
o isolamento entre CNPJs depende **inteiramente** do filtro que a aplicação
escreve na consulta. Um `.eq('empresa_id', …)` esquecido em qualquer tela
vaza dados de outra empresa. **Não corrigido — bloqueado, ver seção G.**

**R4 — Escrita financeira sem autenticação.**
99 de 104 vendas por dia entram sem usuário. Não há como saber quem gravou,
nem impedir que qualquer portador da chave pública grave uma venda forjada.

### MÉDIO

**R5 — Ausência de `created_by`/`updated_by` em todas as tabelas
financeiras.** Só `vendedores` tem. Responsável é texto livre quando existe.

**R6 — `contas_pagar`, `recebimentos`, `cr_auditoria`, `renegociacoes` e
`credito_utilizacoes` sem `updated_at`.**

**R7 — Pagamento de conta a pagar é `UPDATE` destrutivo**, sem evento e sem
auditoria: pagar, despagar e repagar não deixa rastro.

**R8 — `is_system_admin()` e `minha_empresa_id()` são VOLATILE.** Em policy,
função volátil é reavaliada por linha. `empresa_do_meu_grupo` é STABLE, mas
chama `minha_empresa_id()`, que não é. Custo de performance quando a RLS
financeira entrar.

### BAIXO

**R9 — `venda_itens` sem `empresa_id`.** Aceitável: o padrão da casa para
tabela filha é herdar pelo pai (`entrada_itens` e `marketplace_pedido_itens`
já fazem isso com `EXISTS`). Documentado, não alterado.

**R10 — Índice de `empresa_id` ausente** em `cr_auditoria`,
`credito_utilizacoes` e `renegociacoes`. Só importa quando a RLS chegar
nelas.

---

## C. Alterações realizadas

### Migration 1 — `20260906233000_seguranca_financeira_revogar_truncate_e_delete_do_anon.sql`

```sql
REVOKE TRUNCATE ON TABLE
  vendas, venda_itens, contas_receber, contas_pagar, recebimentos,
  creditos_cliente, credito_utilizacoes, renegociacoes, cr_auditoria,
  clientes, empresa_auditoria
FROM anon, authenticated;

REVOKE DELETE ON TABLE
  contas_pagar, recebimentos, creditos_cliente, credito_utilizacoes,
  renegociacoes, cr_auditoria, contas_receber
FROM anon;

REVOKE DELETE ON TABLE empresa_auditoria, cr_auditoria FROM anon, authenticated;
```

Justificativa de risco:
- **TRUNCATE**: o PostgREST não expõe TRUNCATE. Não existe verbo REST que o
  produza. Risco de regressão **nulo por construção**, não por medição.
- **DELETE**: zero DELETEs do `anon` em 24h, e há precedente direto — a
  Onda 2 (30/08) já revogou DELETE de `vendas` e `venda_itens` e o PDV
  externo continuou vendendo.

### Migration 2 — `20260906233500_seguranca_fechar_escalacao_de_privilegio_system_admins.sql`

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE system_admins
FROM authenticated, anon;
```

Justificativa de risco: **nula**. A aplicação inteira só faz `.select()` nesta
tabela — quatro pontos, verificados um a um, zero escritas em todo o
repositório. Administradores são provisionados fora da aplicação, com a chave
de serviço, que GRANT de `authenticated` não afeta. A leitura não foi tocada,
então `is_system_admin()` e as telas de saas-admin seguem funcionando.

### Função central de acesso — **não criada, porque já existe**

O item 6 do escopo pedia avaliar se existe algo equivalente a
`usuario_pode_acessar_empresa(empresa_id)`. **Existe, e é melhor que o
esboço:**

```sql
CREATE OR REPLACE FUNCTION public.empresa_do_meu_grupo(p_empresa uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p_empresa = minha_empresa_id()
      OR EXISTS (SELECT 1 FROM usuario_empresas ue
                 WHERE ue.user_id = auth.uid() AND ue.empresa_id = p_empresa AND ue.ativo);
$$
```

Já é usada em ~40 policies, na forma
`empresa_do_meu_grupo(empresa_id) OR is_system_admin()`, com role
`authenticated`. **Uma segunda arquitetura de autorização não foi criada.**
Quando a RLS financeira entrar, ela usa esta.

### Nada mais foi alterado

Nenhuma policy criada, nenhuma RLS habilitada, nenhum índice criado, nenhuma
tabela, coluna, rota, tela ou regra de negócio tocada.

---

## D. Matriz final de acesso

| Tabela | RLS | `anon` | `authenticated` | Origem real da escrita |
|---|---|---|---|---|
| `vendas` | ❌ | SELECT, **INSERT** | SELECT, INSERT, UPDATE, DELETE | PDV externo (anon, 99/dia) · PDV web · rotas de servidor |
| `venda_itens` | ❌ | SELECT, **INSERT** | SELECT, INSERT, UPDATE, DELETE | idem |
| `recebimentos` | ❌ | SELECT, **INSERT, UPDATE** | SELECT, INSERT, UPDATE, DELETE | PDV externo (anon, 23/dia) · painel |
| `contas_receber` | ❌ | SELECT, **INSERT, UPDATE** | SELECT, INSERT, UPDATE, DELETE | gatilho · PDV externo · painel |
| `contas_pagar` | ✅ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE | painel (authenticated) |
| `creditos_cliente` | ❌ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE | PDV web · painel |
| `credito_utilizacoes` | ❌ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE | painel |
| `renegociacoes` | ❌ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE | painel |
| `cr_auditoria` | ❌ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE | painel |
| `clientes` | ❌ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE | PDV · painel |
| `empresa_auditoria` | ✅ | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE | `registrarAuditoria` |
| `system_admins` | ❌ | — | **SELECT apenas** | provisionamento externo |

Em negrito, o que permanece aberto e é usado.
**Nenhuma tabela financeira tem mais DELETE ou TRUNCATE pelo `anon`.**

---

## E. Testes

| Verificação | Resultado |
|---|---|
| `npm test` | **543 testes, 543 passando, 0 falhando** |
| `npx tsc --noEmit` | limpo |
| Grants após migration (catálogo) | `anon` sem DELETE/TRUNCATE em nenhuma das 11 tabelas financeiras — consulta retornou vazio |
| Grants preservados | `vendas` INSERT/SELECT, `venda_itens` INSERT/SELECT, `recebimentos` INSERT/SELECT/UPDATE, `contas_receber` INSERT/SELECT/UPDATE — todos intactos |
| `system_admins` após migration | `authenticated` com SELECT, REFERENCES, TRIGGER apenas |
| Produção após migration | escritas do `anon` em `estoque_movimentacoes` (POST 201) e `produtos` (PATCH 200) às 23:33, **depois** das migrations. Nenhum 4xx novo. |

### Testes de segurança automatizados — **não criados**

O item 19 pede testes provando que a Empresa A não acessa a Empresa B e que o
`anon` não escreve. **Não foram criados, e é uma lacuna consciente:**

- provar comportamento de RLS exige **executar** INSERT/SELECT como `anon` e
  como usuários de empresas diferentes, contra um banco real. Não há staging,
  e a fase proíbe escrever dado em produção;
- os testes do repositório são `node:test` sobre funções puras, sem
  infraestrutura para subir um Postgres com as policies e semear dois
  tenants.

O que foi verificado no lugar: **o catálogo de privilégios**, que é
definitivo para GRANT/REVOKE (não depende de comportamento em tempo de
execução). Para RLS, quando ela entrar, um teste de comportamento passa a ser
obrigatório — e exige `supabase db start` local ou um projeto de staging.
Registrado como pré-requisito da Fase 1.

### Teste de regressão funcional — **parcial**

O item 20 pede validar venda em dinheiro/PIX/cartão/carteira, cancelamento,
devolução, recebimento, pagamento de conta, crédito. **Não executei nenhum
deles**, porque cada um grava dado real em produção — venda de teste é venda,
baixa estoque e entra na fila de marketplaces.

A validação possível e realizada foi indireta e é forte no que cobre:
nenhum privilégio usado pelos fluxos medidos foi tocado, e o tráfego do
`anon` continuou retornando 2xx depois das migrations.

---

## F. Regressões

**Nenhuma encontrada.**

Fundamento: as migrations só revogaram TRUNCATE (impossível de emitir via
PostgREST) e DELETE (zero uso medido em 24h, com precedente da Onda 2), mais
escrita em `system_admins` (zero uso em todo o código). Todos os privilégios
que a medição mostrou em uso foram preservados, e a produção seguiu gravando
com 2xx após a aplicação.

---

## G. Pontos ainda não seguros

### BLOQUEIO DE SEGURANÇA — RLS nas quatro tabelas centrais

**Fluxo que depende:** venda no balcão e recebimento de cliente, pelo PDV
externo (`vargasnexus-pdv`).

**Por quê:** ele conecta com a **chave anônima**, autentica o operador por
`autenticar_operador_pdv` (RPC SECURITY DEFINER que confere `usuarios_pdv`) e
escreve como `anon`. Ele **nunca vira um usuário do Supabase**, então
`auth.uid()` é nulo em todas as suas escritas.

**Evidência:** 99 POSTs em `/vendas`, 98 em `/venda_itens`, 23 em
`/recebimentos` e 23 PATCHes em `/contas_receber` no papel `anon` com
`request.sb.auth_user` vazio, em 24h. Mais o precedente documentado em
`supabase-corrigir-baixa-estoque-gatilho-fila.sql`: um REVOKE em 30/08 às
08:32 parou a baixa de estoque do balcão **em silêncio**, e o estrago só foi
medido três dias depois (de 134 vendas no dia, só 31 baixaram estoque).

**Alternativa segura, em ordem de preferência:**

1. **O PDV externo passa a autenticar.** Cada terminal recebe um usuário do
   Supabase (ou um JWT de serviço com claim de empresa). Aí `auth.uid()`
   existe e a policy padrão da casa funciona sem exceção.
2. **As escritas do PDV passam por RPCs `SECURITY DEFINER`** que validam o
   operador e a empresa internamente, e o `anon` perde INSERT direto. Mantém
   a chave anônima, mas fecha a escrita arbitrária.
3. **Policy com exceção para `anon`** — rejeitada: seria `using (true)` com
   outro nome, e o escopo proíbe.

**Mudança necessária antes de fechar:** o repositório `vargasnexus-pdv`
precisa ser auditado e alterado. **Não tenho acesso a ele.**

### Outros pontos abertos

- `anon` mantém **INSERT** em `vendas`, `venda_itens`, `recebimentos`,
  `contas_receber`, `clientes`, `creditos_cliente`, `contas_pagar`, e
  **UPDATE** em `contas_receber`, `recebimentos`, `clientes`,
  `creditos_cliente`, `contas_pagar`. Os quatro primeiros são usados; os
  demais não apareceram em 24h, mas **24h não é prova de ausência** — é o
  mesmo alerta que o autor da Onda 2 registrou ao adiar essas tabelas para
  uma janela de dia útil. Revogá-los sem medição de semana é o tipo de
  aposta que já custou três dias de estoque errado.
- `system_admins` continua com **RLS desligada**. A escalação está fechada
  pelo REVOKE, mas qualquer usuário autenticado ainda **lê** a lista de
  administradores do SaaS. Habilitar RLS ali é seguro (as três policies já
  estão escritas e cobrem o auto-select que a aplicação faz), mas é uma
  segunda mudança e ficou para validação própria.
- 97 tabelas do schema `public` seguem sem RLS.

---

## H. Dívida técnica

1. **Escrita financeira direta do navegador.** Só duas rotas de servidor
   financeiras existem. Sem camada de servidor não há onde impor
   idempotência, permissão ou auditoria obrigatória. **O módulo de Caixa não
   pode repetir isso.**
2. **Operações críticas sem auditoria.** Nenhuma destas chama
   `registrarAuditoria`: pagamento de conta a pagar
   (`PagarContasModal.confirmar`), recebimento
   (`ContasReceberClient`), recebimento em massa, uso de crédito,
   renegociação. Só as duas rotas de servidor de venda auditam.
3. **Ausência de `user_id`** em todo o financeiro; responsável é texto livre
   e frequentemente nulo (`recebimentos.operador_nome`: 121 de 122 nulos).
4. **DELETE destrutivo** disponível para `authenticated` em todas as tabelas
   financeiras. A arquitetura declarada prefere status e estorno.
5. **Formas de pagamento em texto livre** em três tabelas, com vocabulários
   divergentes (`misto` × `multiplo`).
6. **`is_system_admin()` e `minha_empresa_id()` VOLATILE** — reavaliadas por
   linha em policy.
7. **`recebimentos.conta_destino` é campo morto** — no insert, nunca na tela.

---

## I. Go / No-Go para a Fase 1

# NO-GO

**Não é seguro construir o controle de dinheiro sobre esta base ainda.**

O motivo não é a tabela nova. As tabelas do Caixa da Empresa *podem* nascer
seguras — com RLS ativa, `empresa_id`, escrita só por servidor e sem DELETE —
e nada do PDV externo as conhece.

O problema é **de onde o caixa tira o número esperado**. O fechamento de um
PDV se calcula a partir de `vendas` e `recebimentos`. Essas duas tabelas
estão hoje sem RLS e com INSERT liberado para a chave anônima que viaja
dentro do JavaScript público. Construir a conferência de dinheiro físico em
cima delas seria montar um controle cuja base qualquer um pode escrever: a
divergência apontada pelo sistema deixaria de significar "faltou dinheiro na
gaveta" e passaria a significar "alguém, em algum lugar, escreveu alguma
coisa".

**Condição objetiva para virar GO:** o PDV externo autenticar — pela via 1 ou
2 da seção G — e, com isso, `vendas`, `venda_itens`, `recebimentos` e
`contas_receber` receberem RLS no padrão
`empresa_do_meu_grupo(empresa_id) OR is_system_admin()`.

Isso depende de alteração no repositório `vargasnexus-pdv`, que está fora do
meu alcance. É a decisão que destrava a Fase 1.

**O que ficou melhor hoje, e não é pouco:** a escalação de privilégio que
permitia a qualquer balconista virar administrador de todo o SaaS está
fechada, e a chave anônima não apaga nem esvazia mais nenhuma tabela
financeira.
