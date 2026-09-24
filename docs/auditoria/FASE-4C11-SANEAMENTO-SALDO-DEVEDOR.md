# Fase 4C.1.1 — `saldo_devedor` vira projeção

24/09/2026. **Migration escrita e provada em transação revertida; ainda NÃO
aplicada em produção** (ver "Pendência" no fim).

## Etapa A — todos os escritores

Seis, não os três da primeira leitura.

| # | Escritor | Classe | Ação |
|---|---|---|---|
| 1 | `sincronizar_saldo_devedor_cliente` (trigger em `contas_receber`) | **A** — recálculo determinístico | mantido; vira a **única** fonte |
| 2 | `criar_conta_carteira` (SQL) | B — incremento cego | `UPDATE clientes` removido |
| 3 | `ContasReceberClient.tsx` (baixa) | B — decremento cego | removido |
| 4 | `ReceberEmMassaModal.tsx` (baixa em massa) | B — decremento cego | removido |
| 5 | `api/vendas/[id]/cancelar` | B — decremento cego | removido |
| 6 | `PDVClient.tsx` (fiado) | B — incremento cego | removido; `data_ultima_compra_fiada` preservada |

**Electron: classe D, não é escritor.** `mapCliente` só alimenta
`db.clientes.upsertBatch` no SQLite local — sync de descida. `api.js` registra
que `atualizarCliente` (que aceitava `saldo_devedor` arbitrário com chave
anônima) já foi removido como código morto. `/api/pdv/clientes` lê o campo no
snapshot e nunca o escreve.

Nenhum outro: a varredura de `pg_proc` por `saldo_devedor` devolve **apenas
duas funções**, as linhas 1 e 2 acima.

## Etapa B — a fonte autoritativa

A fórmula sai do corpo do gatilho e vira `saldo_devedor_autoritativo(uuid)`.
O gatilho passa a chamá-la; o backfill usa a mesma função. **Uma definição.**

Semântica **inalterada**, auditada e não inventada: `SUM(valor_aberto)`
excluindo somente `cancelado`. `vencido` continua sendo dívida — são 11 contas
da migração Base44 (26/07), e nada no sistema atual escreve esse status.

Não há RPC recalculadora concorrente: o gatilho é o único caminho, e o
backfill roda uma vez dentro da migration.

## Etapa C — status

`valor_aberto` é GENERATED STORED; `status` é manual e **sem CHECK**. Medido
em produção: **zero incoerências** — nenhuma `recebido` com saldo, nenhuma
`parcial` sem recebimento, nenhum `valor_aberto` negativo.

O recebimento em massa grava `status: 'recebido'` fixo, e isso está correto:
`calcularRateio` roda em modo `detalhado` com `valor = valor_aberto`, ou seja,
sempre quita integralmente. Não é defeito.

Esta fase **não** redesenha `contas_receber`. A decisão registrada para a 4C:
conta com **qualquer** recebimento, liquidação ou cancelamento **não** pode ter
`valor_original` alterado pela ingestão — conflito explícito, sem
`parcela_numero=2` automática e sem reabrir obrigação liquidada.

## Etapa D — uma venda, uma conta de carteira

Índice **parcial**: `UNIQUE (origem_id) WHERE origem='carteira' AND origem_id IS NOT NULL`.

Três razões para não ser genérico:
- a única `origem` em produção é `carteira` (256 contas); **não existe**
  `origem='venda'`;
- o caminho de **fiado** cria N parcelas com o **mesmo** `origem_id` — um
  único global recusaria a segunda parcela;
- 5 contas históricas (Base44/SYSEMP, 26/07) têm `origem_id` nulo.

Medido: 0 duplicatas, então a trava nasce sem limpeza prévia.

## Etapa E — correção dos dados

Antes: 109 clientes, **9 divergentes**, **R$ 610,12** a mais no cadastro; nos
9, a diferença é exatamente o `valor_original` da última conta de carteira.
**Zero** clientes com saldo sem nenhuma conta — o backfill não esconde decisão
financeira.

O `UPDATE` recalcula pela função autoritativa, só onde há diferença, sem
nenhum valor fixo. Não toca `contas_receber`, `recebimentos`, `valor_original`,
`valor_recebido` nem histórico: corrige a **projeção**, não o documento.

## Etapa F — regressão em transação revertida

As funções corrigidas foram criadas **dentro da transação**, exercitadas e
descartadas. Antes e depois, medidos no mesmo banco:

| Cenário | Resultado |
|---|---|
| venda carteira R$ 100 — **antes** | saldo **200,00** vs SUM 100,00 — dobro |
| venda carteira R$ 100 — **depois** | saldo **100,00** ✔ |
| + venda carteira R$ 30 | 130,00 ✔ |
| recebe 50 parcial | 80,00 ✔ |
| quita a primeira | 30,00 ✔ |
| cancela a segunda | 0,00 ✔ sem dupla subtração |
| 2ª conta de carteira da mesma venda | bloqueada pelo índice ✔ |
| fiado com 2 parcelas, mesmo `origem_id` | permitido ✔ (saldo 100,00) |
| cliente sem contas | 0,00, preservado ✔ |
| incoerências status × `valor_aberto` | 0 ✔ |

Depois da reversão: 0 clientes de teste, 109 clientes, 256 contas, 140
recebimentos, `venda_pagamento` 0, `caixa_movimento` 13,
`caixa_transferencia` 6, índice inexistente, função inexistente. Nada
persistiu.

## Suíte

`tests/contas/saldo-devedor.test.ts`, 16 testes. Provados **não-vazios**: a
asserção de "nenhum escritor cego" reprova as quatro versões anteriores dos
arquivos e aprova as quatro atuais.

`npm test` 1116/1116 · `tsc --noEmit` limpo · `next build` OK ·
`git diff --check` OK.

## Pendência

A migration `saldo_devedor_projecao_v1.sql`
(md5 `de38feeada6f32d0ad056101860c2b9a`) **não foi aplicada**: a chamada de
`apply_migration` foi recusada pelo classificador do modo automático. O nome
do arquivo está provisório (`20260924999999_`) e precisa ser renomeado para a
`version` registrada, com prova de md5, assim que a aplicação for liberada.

Enquanto ela não for aplicada, o banco **ainda dobra** o saldo a cada venda em
carteira. As correções de código já removem os outros três escritores cegos e
são seguras isoladamente — todas apenas deixam de escrever um valor que o
gatilho já calcula.
