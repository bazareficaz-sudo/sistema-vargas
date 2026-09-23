# ADR-001 — Onde vive o pagamento de uma venda

**Status: proposta.** Fase 4B, 23/09/2026. Nenhum DDL aplicado.

## A pergunta

A Fase 4A provou que `vendas.pagamentos jsonb` já existe, já está preenchida
em 30 das 3.830 vendas e já tem dois consumidores corretos (emissão de
NFC-e e o trigger `criar_conta_carteira`).

A decisão é: **manter o pagamento como jsonb dentro da venda, ou criar
entidade própria?**

## O que os dados dizem

| Medida (23/09/2026) | |
|---|---|
| vendas | 3.830 |
| com `pagamentos` preenchida | 30 |
| **com mais de um elemento no array** | **0** |
| chaves usadas | `forma`, `valor` — nada além |
| índices sobre `pagamentos` | **nenhum** |
| constraints sobre `pagamentos` | **nenhuma** |
| vendas canceladas | 0 |
| contas a receber de carteira | 255 |

O array existe, mas nunca carregou mais de um pagamento e nunca teve
garantia nenhuma do banco.

## Os critérios que decidem

Não são todos os doze da lista — três deles decidem sozinhos, porque são
requisitos explícitos desta fase e do teste de ouro.

### 1. Idempotência por pagamento

O teste de ouro exige: *"o ledger da gaveta recebe exatamente +R$50 uma
única vez; retry/sync não duplica o movimento"*.

Para o ledger saber que já processou um pagamento, ele precisa de uma
**identidade estável** por pagamento e de uma garantia do banco de que o
efeito não se repete.

Este projeto já resolveu esse problema exato três vezes, e as três com a
mesma forma:

| Fase | Identidade | Garantia no banco |
|---|---|---|
| 0.6D.2 — venda | `vendas.id` do cliente | `pdv_venda_sync` + índice único parcial |
| Fase 2 — transferência | `caixa_transferencia.id` do cliente | PK + `UNIQUE (transferencia_id, caixa_id)` |
| Fase 3 — sessão | `caixa_sessao.id` do cliente | PK + índice único parcial |

Com jsonb, a identidade do pagamento seria "o terceiro elemento do array da
venda X". Não há PK, não há FK, não há índice único. A não-duplicação
viraria **convenção de aplicação** — exatamente o que as três fases
anteriores recusaram, e com razão: a 0.6D.2 documentou que confiar em
verificação na aplicação, sem trava no banco, deixa passar sob concorrência.

### 2. Estorno individual com append-only

O item 10 pede: *estorno individual, princípio append-only, preservar o
vínculo entre original e estorno, não sobrescrever silenciosamente.*

Com jsonb, estornar um pagamento é **reescrever o array inteiro** — um
`UPDATE` em `vendas`. E `vendas` tem `UPDATE` liberado para
`authenticated`. O array anterior desaparece sem rastro.

Isso contradiz frontalmente o que o módulo de Caixa estabeleceu em três
fases: `caixa_movimento`, `caixa_transferencia` e `caixa_sessao` têm
`UPDATE` e `DELETE` negados por grant **e** por policy, e a correção é
sempre um registro novo apontando para o original por `estorno_de_id`.

Um pagamento é dinheiro. Tratá-lo com garantia menor que a de um movimento
de caixa seria incoerente.

### 3. O vínculo com o ledger

Quando a parcela em dinheiro virar movimento, esse movimento precisa
apontar para **qual pagamento** o originou — para rastreabilidade e para o
índice único que impede o segundo lançamento.

`caixa_movimento` já tem o par `referencia_tipo` / `referencia_id` (uuid),
desenhado na Fase 1 justamente para isso, e `idx_estoque_mov_venda_item_unico`
já é o precedente do padrão. Apontar para "o elemento 2 do array da venda X"
não cabe num uuid.

### Os demais critérios

| Critério | jsonb | tabela |
|---|---|---|
| adquirente, NSU, autorização | cabe, sem validação | colunas com CHECK |
| múltiplos cartões | indistinguíveis sem identidade | cada um com sua linha |
| fiscal | **já lê o array** | precisa da projeção (ver abaixo) |
| sync offline | trivial: o payload já é JSON | exige tabela local no SQLite |
| performance | 3.830 vendas — irrelevante nos dois | idem |
| auditoria | array reescrito sem rastro | append-only |

Performance não decide nada nesta escala. Sync offline é o único critério
que favorece o jsonb, e o custo do outro lado é uma tabela local a mais —
que o PDV já sabe criar (`venda_itens` é exatamente isso).

## Decisão

**Opção B — entidade própria `venda_pagamento` — com `vendas.pagamentos`
mantida como projeção derivada.**

```
venda_pagamento          ← fonte da verdade, append-only
    │  (trigger ou RPC projeta)
    ▼
vendas.pagamentos jsonb  ← projeção de compatibilidade, continua existindo
```

A projeção é o que torna a decisão barata: **nenhum consumidor atual
precisa mudar**. A emissão de NFC-e continua lendo o array com seu
fallback; `criar_conta_carteira` continua somando a parcela de carteira do
array. Os dois seguem funcionando sem uma linha alterada.

E a fonte canônica ganha o que o jsonb não dá: PK por pagamento, estorno
por referência, `UPDATE`/`DELETE` negados, e um alvo estável para o
`referencia_id` do ledger.

## O que esta decisão NÃO inclui

Coerência com o princípio que este módulo segue desde a Fase 1 — *estender
um CHECK depois é barato; ter uma coluna que nada preenche é dívida
silenciosa*:

- **sem colunas de adquirente, NSU, bandeira ou autorização agora.** Nada
  as produz: o PDV não coleta e nenhuma integração de adquirente existe.
  Entram quando houver quem as preencha.
- **sem tabela local no SQLite nesta fase.** O contrato fica definido; a
  tabela nasce na 4C, junto com a UI que a preenche.
- **sem status de pagamento além do mínimo.** `estornado` é derivado da
  existência do estorno, como já é em `caixa_transferencia`.

## O contra-argumento, e a resposta

*"Criar tabela agora é construir à frente da necessidade — o PDV ainda
manda uma forma só."*

É o princípio certo, aplicado ao caso errado. Construir à frente seria
criar colunas de NSU que ninguém preenche — e é justamente isso que a
decisão exclui. A tabela em si não é antecipação: ela responde a um
requisito que **já chegou** (múltiplos pagamentos + ledger idempotente), e
sem ela a Fase 4C teria de implementar estorno e idempotência sobre um
array sem garantias, para depois migrar.

## Consequências

**Boas.** Um pagamento passa a ter identidade; o ledger ganha um alvo
estável; estorno individual fica possível com o mesmo padrão já homologado;
múltiplos cartões deixam de ser indistinguíveis.

**Custos.** Uma migration nova; a projeção precisa ser mantida em sincronia
(feita por trigger, não por aplicação, para não depender de quem escreve);
e o SQLite ganha uma tabela na 4C.

**Risco a vigiar.** Duas representações do mesmo fato — a tabela e a
projeção — podem divergir. Mitigação: a projeção é **gerada por trigger** a
partir da tabela, nunca escrita diretamente, e um teste de banco prova que
`sum(venda_pagamento.valor) = sum(pagamentos[].valor)` para toda venda que
tenha pagamentos na tabela.
