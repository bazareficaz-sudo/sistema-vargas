# Fase 0.6C.3 — down-sync de orçamentos

**Data:** 10/09/2026 · **Escopo:** só a descida de orçamentos.
**Não toca:** rota autenticada de upload, idempotência, criação/edição/cancelamento,
`pdv_operacoes`, auth do terminal, flags, RLS, `anon`, vendas, recebimentos,
Caixa/Tesouraria, conversão em venda, `faltas`.

---

## 1. O defeito, reproduzido

`UNIQUE constraint failed: orcamentos.remote_id`, a cada ciclo de sync (2 min),
desde 08/09/2026 — **988 ocorrências** até 10/09.

Reproduzido contra cópia do banco real (`VACUUM INTO`; o banco vivo só foi
aberto em `readonly`):

```
erro .......... UNIQUE constraint failed: orcamentos.remote_id
code .......... SQLITE_CONSTRAINT_UNIQUE
posição ....... item 2 de 56
documento ..... id=ee29e3b9-8389-4c1c-8f88-7ad289639064 numero=59 R$389
SQL ........... INSERT INTO orcamentos ... ON CONFLICT(id) DO UPDATE
constraint .... orcamentos.remote_id (TEXT UNIQUE)
```

### As duas linhas

| | `id` | `remote_id` | `numero` | `status` |
|---|---|---|---|---|
| local | `d87547a7-89f3-4319-8cf4-d4e1b2fa83ca` | `ee29e3b9-8389-4c1c-8f88-7ad289639064` | 58 | pendente / synced |
| remoto | `ee29e3b9-8389-4c1c-8f88-7ad289639064` | — | **59** | aberto |

### A mecânica

A tabela local tem **duas** colunas de identidade: `id` (PK) e `remote_id`
(UNIQUE). O lote que desce traz o id do **servidor**. Num orçamento nascido no
legado, esse id mora no `remote_id` de uma linha cujo `id` é outro.

1. `ON CONFLICT(id)` procura a PK `ee29e3b9…` — não existe localmente;
2. sem conflito de PK, o comando segue como **INSERT**;
3. o INSERT grava `remote_id = ee29e3b9…`, que `d87547a7…` já ocupa;
4. `UNIQUE` dispara, a transação **inteira** faz rollback.

### O bloqueio dos demais

```
itens do lote antes da falha ....  1
itens depois ....................  54   (nunca tentados)
linhas com synced_at da rodada ..  0    (nada aplicado)
```

Nem o item 1, que tinha passado, sobrevivia. Durante dois dias **nenhum**
número, status ou total foi reconciliado neste terminal.

### Ambiguidade de identidade — medida

```
linhas locais cujo id é remote_id de OUTRA linha ....... 0
remote_id repetidos ................................... 0
ids do lote que casam com remote_id local de id != ..... 1
```

Um caso, não uma classe. Mas há **dois** locais com `id ≠ remote_id`: o nº58 e
um resquício Base44 (`fe3fd121…` / `6a481d1dc98da82e12921a85`, nº1) que só não
dispara porque seu status não é `aberto` e ele não desce no lote.

## 2. Causa exata

Das opções levantadas: **`ON CONFLICT(id)` insuficiente**. Não é ordem de
merge, não são duas linhas locais com o mesmo `remote_id` (medido: zero), e não
é INSERT onde deveria haver UPDATE por acaso — é INSERT porque a cláusula de
conflito olha **uma** das duas colunas de identidade.

## 3. A menor correção segura

Resolver a identidade **antes** de escrever, com a mesma regra que o resto do
sistema já usa (`remote_id ?? id`), e então UPDATE ou INSERT:

```sql
SELECT id, remote_id, sync_status FROM orcamentos
 WHERE remote_id = ? OR id = ?
 ORDER BY (remote_id = ?) DESC
 LIMIT 1
```

Preservado: `id_local`, `remote_id`, número comercial oficial, revisões, itens,
referências locais, fila, histórico. Nenhuma linha é recriada ou apagada.

Quando o id do cloud é PK de uma linha **e** `remote_id` de outra, o
`remote_id` vence — determinístico, e a mesma regra de identidade efetiva.

## 4. Transação: de lote para linha

Era `db.transaction` sobre o lote inteiro. Passa a ser **um SAVEPOINT por
linha**.

**Impacto, dito por inteiro:** perde-se o all-or-nothing do lote. Aqui isso não
custa nada — esta descida é **refresco de cache de cabeçalho**, não operação de
negócio. Aplicar metade não deixa o banco inconsistente, e o ciclo seguinte
reaplica o resto. O que o all-or-nothing comprava era um modo de falha
catastrófico: uma linha histórica bloqueando 55 por dias.

Uma falha isolada é **contada** e devolvida a quem chamou, e `sync.js` a
registra com número e mensagem. Silêncio não é desfecho possível.

## 5. O que a descida deixou de escrever

Regra: **não se escreve coluna que o payload não consegue expressar.**

| Coluna | Por quê |
|---|---|
| `status` | a consulta filtra `status IN ('aberto')`, então toda linha que desce tem status `aberto`. A coluna não carrega informação — escrevê-la só trocava o `pendente` local, que é o que dá botão de **editar, converter em venda e cancelar**, por um `aberto` que não dá. |
| `cliente_telefone` | o mapeamento remoto devolve `null` fixo. Escrever só poderia apagar o telefone local. |
| `revisao_base` | a descida traz só o **cabeçalho**. Adotar a revisão sem os itens deixaria este terminal declarar que partiu de um estado que não tem, e sobrescrever os itens de outro terminal na próxima edição. Com a revisão velha, o servidor responde 409 e a operação **para** — que é o desfecho correto. |

Sem isso, corrigir o `UNIQUE` teria trocado um defeito por outro: os 3
orçamentos locais em `pendente` (entre eles o nº60, validado na 0.6C.2)
virariam `aberto` e perderiam os botões no primeiro ciclo de sync.

## 6. Testes

**57 no total, 14 falham no comportamento anterior.**

| # | Cenário | |
|---|---|---|
| 1 | `id_local ≠ remote_id` | ✱ |
| 2 | `remote_id` já existente em outra linha local | ✱ |
| 3 | down-sync do nº58 atual, com ids reais | ✱ |
| 4 | número oficial atualizado | ✱ |
| 5 | status preservado — e por quê | ✱ |
| 6 | revisão preservada | |
| 7 | vários orçamentos no mesmo lote, novos e existentes | ✱ |
| 8 | um registro problemático não impede os demais | ✱ |
| 9 | reexecução do mesmo lote (3×) é idempotente | ✱ |
| 10 | nenhum documento duplicado — identidades = linhas | ✱ |

O teste 8 usa de propósito uma falha que **não** é a colisão corrigida (um
valor que não pode ser ligado ao SQLite): o isolamento não pode depender de eu
ter previsto o defeito.

Os testes executam a **mesma função** que o app executa — `reconciliarDoCloud`
só precisa de `prepare()` e `exec()`, que better-sqlite3 e `node:sqlite` têm
igual. Não há imitação do comportamento em lugar nenhum.

## 7. Prova contra cópia do banco real

Cópia por `VACUUM INTO` do banco do Escritório Silvano; o vivo só em `readonly`.

```
                       ANTES        DEPOIS
orçamentos               57            57
itens                     4             4
fila (total/pendente)   52 / 0        52 / 0
identidades distintas    57            57
status pendente           3             3
status aberto            54            54
com telefone              1             1
integridade              ok            ok

descida: total=56  atualizados=56  inseridos=0  preservados=0  falhas=0
linhas com synced_at da rodada: 56        (antes da correção: 0)

nº58  id=d87547a7 remote=ee29e3b9 nº58 → nº59   ← única mudança do snapshot
nº60  id=1a4ca66e remote=1a4ca66e nº60          ← intacto, rev=3, R$276,30

segunda passada: 56 atualizados, 0 inseridos, 0 falhas, integridade ok
tela: 58 linhas para 58 identidades
```

Zero `UNIQUE`. O histórico reconciliado. Contagem de documentos inalterada.
Fila intocada.

## 8. Riscos residuais

1. **O resquício Base44** (`fe3fd121…` / `6a481d1dc98da82e12921a85`, nº1)
   continua com `id ≠ remote_id`. Agora ele é tratado corretamente se descer,
   mas hoje não desce (status ≠ `aberto`). Não foi mexido.
2. **Os 54 orçamentos com `status = 'aberto'` local** continuam fora do
   vocabulário local e sem botões de editar/converter. Não foi a descida que os
   pôs assim — 54 dos 57 têm `forma_pagamento` nulo, o que só acontece em linha
   **inserida** pelo cloud, não criada aqui. Fica registrado como dívida
   separada, não corrigida nesta subfase.
3. **A descida segue trazendo só o cabeçalho.** Itens de outro terminal não
   chegam. É o que torna correto não adotar a revisão.
4. **Não rodou no app real ainda** — a prova é contra cópia. O terminal
   continua em 1.9.5; a 1.9.6 está construída e **não publicada**.
5. **`pdv_operacoes` e `pdv_terminais` seguem sem leitura** nesta sessão (o
   conector Supabase precisa ser reautorizado; a chave `anon` é barrada nas
   duas, corretamente).

## 9. Entrega

`vargasnexus-pdv` — commit `8ff3f5b`, versão **1.9.6**, instalador
`dist/VargasNexus PDV Setup 1.9.6.exe` (82.762.242 bytes).
**Não publicado. Nenhuma flag alterada.**
