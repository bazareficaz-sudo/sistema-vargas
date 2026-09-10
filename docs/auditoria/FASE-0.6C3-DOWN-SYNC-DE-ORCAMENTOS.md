# Fase 0.6C.3 — down-sync de orçamentos

**Data:** 10/09/2026 · **Escopo:** só a descida de orçamentos.
**Não toca:** rota autenticada de upload, idempotência, criação/edição/cancelamento,
`pdv_operacoes`, auth do terminal, flags, RLS, `anon`, vendas, recebimentos,
Caixa/Tesouraria, conversão em venda, `faltas`.

---

## 1. O defeito, reproduzido

`UNIQUE constraint failed: orcamentos.remote_id`, a cada ciclo de sync (2 min),
desde 08/09/2026 — **1081 ocorrências** até a correção entrar.

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
SELECT id, remote_id, numero, sync_status FROM orcamentos
 WHERE remote_id = ? OR id = ?
 ORDER BY id
```

Sem `LIMIT`: a **contagem** de correspondências é a informação — ver §7b.

Preservado: `id_local`, `remote_id`, número comercial oficial, revisões, itens,
referências locais, fila, histórico. Nenhuma linha é recriada ou apagada.

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

## 7b. Guardrail de identidade ambígua

Pedido antes de publicar, e o reconciliador **não** cobria: ele localizava a
linha com `LIMIT 1` e um critério de desempate, escolhendo em silêncio quando
duas linhas locais casassem com o mesmo `cloud.id`. Pior: o teste que eu tinha
escrito — *"o remote_id vence"* — **consagrava** a escolha silenciosa.

Agora a contagem de correspondências é a informação:

```
0 linhas   → INSERT
1 linha    → UPDATE nessa identidade
2 ou mais  → nada é escrito
```

No caso ambíguo nada é apagado, fundido, recriado ou alterado. A linha do lote
sai como conflito/preservada e o caso vai inteiro para o log:

```
[SYNC] Orçamentos: identidade_ambigua — cloud X (nº99)
       casa com ids locais [A, X]  remote_ids [X, null]  números [11, 22]
       — nada alterado
```

O restante do lote continua, linha a linha, por SAVEPOINT.

**Teste** (`local A: id=A, remote_id=X` · `local B: id=X` · `cloud: id=X`):
nenhuma linha apagada, nenhuma sobrescrita — comparação campo a campo do antes
e do depois, não amostragem —, nenhuma terceira criada, itens intactos, o resto
do lote aplicado, e rerun com relato idêntico. **58 testes verdes**; este falha
com o `LIMIT 1` de volta.

Nos dados reais: `ambiguos = 0`. O guardrail é para o caso que hoje não existe
— que é exatamente quando ele vale.

## 7c. Validação em produção — Escritório Silvano, 1.9.6

Publicada em 10/09/2026 17:02 (BRT). Terminal atualizado às 17:13, confirmado
pelo próprio app: *"Update for version 1.9.6 is not available (latest version:
1.9.6)"*. SQLite inicializado sem erro, sem warn novo.

### Quatro ciclos normais, sem falha provocada

```
17:14:03  57 do servidor — 56 atualizados, 1 novos, 0 preservados, 0 ambíguos, 0 falhas
17:15:59  57 do servidor — 57 atualizados, 0 novos, 0 preservados, 0 ambíguos, 0 falhas
17:17:59  57 do servidor — 57 atualizados, 0 novos, 0 preservados, 0 ambíguos, 0 falhas
17:19:59  57 do servidor — 57 atualizados, 0 novos, 0 preservados, 0 ambíguos, 0 falhas
```

Do segundo ciclo em diante: **zero inserções**. Idempotente.

### O `UNIQUE` parou

```
última ocorrência ....... 17:13:22   (35 s ANTES da instalação da 1.9.6)
contador ................ 1081, parado
falhas desde a 1.9.6 .... 0
ambiguidades ............ 0
```

### Contagens

```
                  ANTES (17:02)   DEPOIS (17:20)
orçamentos             57              58
identidades            57              58        1:1, sem duplicata
itens                   4               4
fila (total/pend.)    52 / 0          52 / 0
pendentes / abertos   3 / 54          3 / 55
com telefone            1               1
id ≠ remote_id          2               2        preservados
integridade            ok              ok
```

### O `1 novos` do primeiro ciclo

É o **nº61** (`b29d4bb2…`, R$ 274,50), criado **por outro terminal** às 16:01
do mesmo dia pelo caminho legado (`terminal_id = null`). Não é documento
inventado pela reconciliação: existe no servidor, `id = remote_id`, e as
identidades locais subiram de 57 para 58 junto com as do servidor.

Vale registrar o que isso revela: este terminal levou **1h13** para saber de um
orçamento criado em outro, porque a descida estava morta desde 08/09. O custo do
defeito não era só o erro no log.

### Os dois documentos sob observação

```
nº58  d87547a7 / ee29e3b9   numero 58 → 59, rev 0, R$ 389,00     reconciliado
nº60  1a4ca66e / 1a4ca66e   numero 60, rev 3, R$ 276,30          intacto
```

57 linhas com `synced_at` das rodadas. Antes da correção esse número era zero.

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
4. **Os outros cinco terminais seguem na versão anterior.** A 1.9.6 está
   publicada e disponível, mas nenhum foi forçado. Enquanto não subirem, cada
   um continua com a descida quebrada e com a lista possivelmente duplicada.
5. **`pdv_operacoes` e `pdv_terminais` seguem sem leitura** nesta sessão (o
   conector Supabase precisa ser reautorizado; a chave `anon` é barrada nas
   duas, corretamente).

## 9. Entrega

`vargasnexus-pdv` — commits `8ff3f5b` (correção) e `7a9de16` (guardrail),
versão **1.9.6**, release `v1.9.6` publicada em 10/09/2026 17:02 (BRT).
Validada em produção só no **Escritório Silvano**.
`orcamentos = true` continua apenas nele. Nenhuma outra flag alterada.
