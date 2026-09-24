# Fase 4C.2 — Passo B — Auditoria de `contas_receber` e `recebimentos`

**Somente leitura. Nenhum DDL, nenhuma escrita.** 24/09/2026.

Guardrail do usuário: *"ANTES de implementar atualização de conta existente,
audite o modelo real. Se alterar o valor de uma conta existente puder
corromper saldo, recebimentos, baixa, status ou histórico, PARE."*

**Resultado: PARE.** Alterar `valor_original` de uma conta existente pode
corromper `status`. E a auditoria encontrou um defeito **já ativo em
produção**, no mesmo caminho que a regra nova usaria.

## O modelo real

| Coluna | Natureza | Consequência |
|---|---|---|
| `valor_aberto` | **GENERATED STORED** `valor_original - valor_recebido` | Nunca diverge. Mudar `valor_original` recalcula sozinho. |
| `valor_recebido` | coluna comum | Escrita pela aplicação, sem trava. |
| `status` | coluna comum, **sem CHECK** | **Não é recalculado por ninguém.** |
| `clientes.saldo_devedor` | derivado por gatilho | `z_trg_sincronizar_saldo_devedor` recalcula `SUM(valor_aberto)` a cada escrita em `contas_receber`. |

Não há CHECK algum em `contas_receber`. Não há índice único em
`(origem, origem_id)` — `idx_cr_origem` é comum. A regra "uma venda gera uma
conta" hoje é só o `IF EXISTS ... RETURN NEW` dentro de `criar_conta_carteira`:
convenção de aplicação, não garantia de banco. Hoje há **0 duplicatas**, então
a trava é criável sem limpeza prévia.

`recebimentos` **não tem gatilho** que escreva em `contas_receber`. A baixa é
feita inteiramente pela aplicação (`ContasReceberClient.tsx`), por
read-modify-write a partir do estado React, sem `WHERE valor_recebido = <antigo>`,
sem RPC e sem lock.

## Estado de produção (256 contas, todas `origem='carteira'`)

| status | contas | original | recebido | aberto |
|---|---|---|---|---|
| aberto | 96 | 4.001,57 | 0,00 | 4.001,57 |
| vencido | 11 | 36,85 | 0,00 | 36,85 |
| parcial | 5 | 438,65 | 184,75 | 253,90 |
| recebido | 139 | 6.603,65 | 6.603,65 | 0,00 |
| cancelado | 5 | 62,50 | 0,00 | 62,50 |

Coerência perfeita entre `status` e `valor_aberto`: nenhuma conta `recebido`
com saldo, nenhuma `parcial` sem recebimento, nenhum `valor_aberto` negativo.
Conta cancelada **conserva** `valor_original`; quem a exclui da dívida é o
gatilho, pelo `status`.

## DEFEITO ATIVO — dupla contagem do saldo devedor

`criar_conta_carteira` faz, nesta ordem:

```
INSERT INTO contas_receber (...)        -- dispara o gatilho:
                                        -- saldo_devedor := SUM(valor_aberto)   [correto]
UPDATE clientes SET
  saldo_devedor = COALESCE(saldo_devedor,0) + v_valor   [soma a MESMA conta de novo]
```

O gatilho `z_trg_sincronizar_saldo_devedor` não existia quando esse `UPDATE`
foi escrito. Hoje os dois coexistem e o incremento cego vem por último.

**Medição em produção:** 9 de 23 clientes com conta divergem, somando
**R$ 610,12 a mais** no cadastro. Para os **9 de 9**, a diferença é
*exatamente* o `valor_original` da última conta de carteira criada:

| Cliente | cadastro | contas | diferença | última conta | |
|---|---|---|---|---|---|
| JOSINALDO | 598,68 | 299,34 | 299,34 | 299,34 | bate exato |
| WELIN | 455,90 | 286,95 | 168,95 | 168,95 | bate exato |
| ESCRITORIO CONTAB. | 1.612,99 | 1.555,29 | 57,70 | 57,70 | bate exato |
| IGOR / DOUGLAS | 502,90 | 478,90 | 24,00 | 24,00 | bate exato |
| IGREJA ADVENTISTA | 101,40 | 79,40 | 22,00 | 22,00 | bate exato |
| Silvano Vargas | 269,26 | 254,63 | 14,63 | 14,63 | bate exato |
| DIEGO CAIRO | 32,00 | 21,00 | 11,00 | 11,00 | bate exato |
| DANIEL BORRACHA | 361,60 | 354,10 | 7,50 | 7,50 | bate exato |
| NELSON ROQUE | 244,62 | 239,62 | 5,00 | 5,00 | bate exato |

JOSINALDO tem saldo **exatamente o dobro** e nunca teve recebimento.
NELSON teve conta criada **hoje** e já diverge.

O erro **se cura sozinho** na escrita seguinte em qualquer conta daquele
cliente — o gatilho recalcula tudo — e **volta a quebrar** na próxima venda
em carteira. Por isso só 9 clientes aparecem: são os que venderam em carteira
depois da última baixa. Não é um dano que acumula indefinidamente, mas o
`saldo_devedor` exibido está errado para esses clientes agora.

A mesma classe de erro existe em dois outros lugares, com sinal invertido
(subtraem depois do recálculo do gatilho): a baixa em
`ContasReceberClient.tsx` e o cancelamento de venda em
`api/vendas/[id]/cancelar/route.ts`.

Este é o caso `produto_estoque × produtos.estoque` outra vez: **saldo em
coluna, escrito por duas fontes independentes.**

## O que o sistema já recusa hoje

- **Cancelar venda** com qualquer conta de `valor_recebido > 0`: HTTP 409.
- **Editar venda** mudando o total com conta não cancelada: HTTP 409.

Ou seja: conta existente já é tratada como quase imutável pelos dois caminhos
que poderiam alterá-la.

## Contrato seguro para a carteira agregada

A decisão aprovada — *uma venda gera UMA conta; recalcular a soma a partir de
`venda_pagamento`, nunca `valor_existente + novo_pagamento`* — é a correta, e
o `valor_aberto` gerado e o gatilho de saldo a tornam viável. Mas ela só é
segura com estas condições, **nenhuma delas implementada ainda**:

1. **Nunca escrever `clientes.saldo_devedor` diretamente.** O gatilho já é
   autoritativo. O novo caminho da carteira não pode repetir o incremento
   cego — e o de `criar_conta_carteira` precisa ser removido, senão a regra
   nova herda o defeito.
2. **Recalcular `status` junto com `valor_original`**, na mesma escrita:
   `valor_aberto <= 0.01 → 'recebido'`, `valor_recebido > 0 → 'parcial'`,
   senão preserva `aberto`/`vencido`. Sem isso, subir o valor de uma conta
   `recebido` a deixa quitada com saldo em aberto.
3. **Recusar, não reescrever, conta já tocada.** Se a conta tem
   `valor_recebido > 0` ou `status = 'cancelado'`, a parcela nova de carteira
   **não** pode alterar o documento. Mesma política dos 409 que já existem.
   O caso precisa de decisão sua: criar parcela nova (`parcela_numero = 2`)
   ou recusar a ingestão do pagamento. Não vou escolher por você.
4. **Trava de banco**: índice único em `(origem, origem_id)` onde
   `origem = 'carteira'`. Hoje não existe e a unicidade é convenção.
5. **Só diminuir para cima do recebido.** O recálculo nunca pode produzir
   `valor_original < valor_recebido`: isso geraria `valor_aberto` negativo,
   que hoje não existe em nenhuma das 256 contas.

## Recomendação

Corrigir a dupla contagem **antes** de implementar a carteira agregada, e em
migration própria, separada da 4C.2 — é defeito preexistente, não desta fase.
São três escritas cegas a remover e um backfill de `saldo_devedor` para os 9
clientes (o próprio gatilho faz, com um `UPDATE` no-op por conta).

Implementar a regra nova por cima do defeito significaria construir a fonte
autoritativa de pagamentos sobre um saldo que já sabemos estar errado.
