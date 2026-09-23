# Fase 4B — Modelo e contratos: venda → pagamentos → caixa

**23/09/2026 · desenho.** Nenhum DDL aplicado, nenhuma migration executada,
nenhuma linha do PDV alterada. Este documento é o que se revisa antes de
autorizar a 4C.

Decisão de modelo em [`ADR-001`](./ADR-001-MODELO-DE-PAGAMENTOS.md).
Levantamento em [`FASE-4A`](./FASE-4A-VENDA-PAGAMENTO-CAIXA.md).

---

## 0. O guardrail acima de tudo

> **O PDV externo não pode parar de funcionar como funciona hoje.**

Todo o desenho abaixo obedece a isto. Concretamente, ao fim de toda a Fase
4 o terminal precisa continuar capaz de:

| Capacidade atual | Como o desenho a preserva |
|---|---|
| vender offline | nada novo exige rede; a tabela local nasce junto da fila existente |
| SQLite local | `venda_pagamentos` local é adição, não substituição |
| baixa de estoque na finalização | intocada no Modelo A |
| fila e sync posterior | payload ganha campo **opcional**; servidor aceita ausência |
| impressão | continua lendo `forma_pagamento` enquanto houver uma só |
| fiscal | continua lendo `vendas.pagamentos` — a projeção garante |
| carteira | `criar_conta_carteira` intocado |
| uma forma de pagamento | continua sendo o caso normal, agora como array de 1 |

**Critério de GO/NO-GO de toda fase seguinte:** um terminal na versão
anterior, sem atualizar, continua vendendo e sincronizando. Se isso quebrar,
é NO-GO — não é detalhe técnico.

---

## B. Modelo conceitual

```
EMPRESA ─── configuracao_caixa (modo operacional)
   │
   ├── PDV_TERMINAL ──────────────────────────┐
   │        │ origina                         │ recebe
   │        ▼                                 ▼
   │     VENDA ──────1..N────► VENDA_PAGAMENTO
   │        │                         │
   │        │                         │ (só as parcelas em espécie)
   │        │                         ▼
   │        │                    CAIXA_MOVIMENTO ──► CAIXA ──► CAIXA_SESSAO
   │        │                    (Fases 1–3, intocadas)
   │        ▼
   │    VENDA_ITENS ──► estoque
   │
   └── CONTAS_RECEBER ◄── parcelas em carteira (trigger atual)
```

**Vínculos que podem não existir** — o modelo não os presume:

| Vínculo | Quando é nulo |
|---|---|
| pagamento → sessão | recebimento administrativo, ou terminal sem sessão aberta |
| venda → terminal recebedor | Modelo A: recebedor = originador; e vendas legadas têm terminal nulo |
| pagamento → caixa | formas que não movimentam gaveta (cartão, PIX) |
| venda → pagamentos | as 3.800 vendas legadas, que continuam válidas |

O precedente já existe e funcionou: `caixa_movimento.sessao_id` é nullable
desde a Fase 3, e os seis movimentos da Fase 2 seguem sem sessão.

### As seis identidades que não são a mesma coisa

| Conceito | Hoje | Proposta |
|---|---|---|
| terminal originador | `vendas.terminal_id` TEXT livre | ganha `vendas.terminal_origem_id` uuid → `pdv_terminais` |
| terminal recebedor | **não existe** | `venda_pagamento.terminal_recebedor_id` |
| caixa físico | `caixa` (Fase 1) | inalterado |
| sessão | `caixa_sessao` (Fase 3) | inalterado |
| usuário vendedor | `vendas.vendedor_*` | inalterado |
| usuário recebedor | **não existe** | `venda_pagamento.usuario_id` |

---

## A. Modelo de dados proposto

### `venda_pagamento` — a entidade nova

```
id                    uuid PK        ← gerado pelo CLIENTE (idempotência)
venda_id              uuid NOT NULL → vendas
empresa_id            uuid NOT NULL → empresas
forma                 text NOT NULL  CHECK (lista das formas existentes)
valor                 numeric(14,2)  CHECK (valor > 0)
                                     ← valor APLICADO à venda

-- dinheiro: o que o cliente entregou e o que voltou
valor_entregue        numeric(14,2)  NULL, só faz sentido em espécie
troco                 numeric(14,2)  NULL

-- quem recebeu (Modelo B); nulo = recebeu quem vendeu
terminal_recebedor_id uuid NULL     → pdv_terminais
usuario_id            uuid NOT NULL
sessao_id             uuid NULL     → caixa_sessao

-- append-only: corrigir é lançar o inverso
estorno_de_id         uuid NULL     → venda_pagamento
recebido_em           timestamptz NOT NULL DEFAULT now()
created_at            timestamptz NOT NULL DEFAULT now()

CHECK (troco IS NULL OR forma = 'dinheiro')
CHECK (valor_entregue IS NULL OR valor_entregue >= valor)
UNIQUE (estorno_de_id) WHERE estorno_de_id IS NOT NULL
```

Sem colunas de adquirente/NSU/bandeira — ver ADR-001, seção "o que esta
decisão não inclui".

**RLS e grants:** mesmo tratamento de `caixa_movimento` — policies
separadas `FOR SELECT` e `FOR INSERT`, sem policy de UPDATE nem DELETE,
`anon` sem privilégio.

### A projeção de compatibilidade

`vendas.pagamentos` **continua existindo** e passa a ser gerada por trigger
a partir de `venda_pagamento`, somando o estorno:

```
[{"forma": "dinheiro", "valor": 50}, {"forma": "credito", "valor": 100}]
```

Nenhum consumidor atual muda. O fiscal e `criar_conta_carteira` seguem
lendo o array, com o mesmo fallback que já têm para vendas sem ele.

### Dinheiro e troco — os quatro números

Venda R$ 150, R$ 100 cartão + R$ 50 dinheiro, cliente entrega R$ 100:

| Conceito | Onde | Valor |
|---|---|---|
| valor aplicado à venda | `venda_pagamento.valor` | **50** |
| valor entregue | `valor_entregue` | 100 |
| troco | `troco` | 50 |
| **efeito líquido na gaveta** | derivado: `valor` | **+50** |

O efeito na gaveta é o **valor aplicado**, não o entregue: os R$ 100 entram
e os R$ 50 saem no mesmo ato, e o líquido é 50. Guardar os três permite
auditar a conferência física sem inferência.

---

## C. Máquina de estados

Hoje só existem `concluida`, `cancelada` e `pendente`, e **toda venda nasce
`concluida`**. Zero vendas canceladas em produção.

A proposta **não renomeia** nada e não muda o Modelo A.

```
                       ┌──────────────── MODELO A (atual, intocado) ───────────────┐
   carrinho ──────────►│  finaliza com pagamento  ──►  CONCLUIDA                   │
                       └──────────────────────────────────────────────────────────┘

                       ┌──────────────── MODELO B (novo, opcional) ────────────────┐
   carrinho ──────────►│  AGUARDANDO_PAGAMENTO ──► CONCLUIDA                       │
                       │          │                                               │
                       │          ├──► CANCELADA      (operador desiste)           │
                       │          └──► EXPIRADA       (prazo esgotado)             │
                       └──────────────────────────────────────────────────────────┘

   pagamento:  EFETIVADO ──► ESTORNADO   (registro novo, nunca UPDATE)
```

`AGUARDANDO_PAGAMENTO` **só existe no Modelo B**. No Modelo A a venda
continua nascendo `concluida`, como hoje — é isso que preserva o offline.

### Estoque nos estados novos

O problema a resolver: *última unidade vendida no Balcão 01, cliente
caminha até o Caixa, Balcão 02 vende a mesma unidade.*

| Estado | Efeito no estoque |
|---|---|
| `CONCLUIDA` (Modelo A) | baixa na finalização — **inalterado** |
| `AGUARDANDO_PAGAMENTO` | **comprometido**: baixa do disponível, com vínculo à venda |
| → `CONCLUIDA` | o comprometimento vira baixa definitiva |
| → `CANCELADA` / `EXPIRADA` | devolvido |

Isto é desenho, não implementação: mexer em estoque exige checkpoint
próprio, e a 4A registrou que hoje **não há reserva, há baixa**. A escolha
entre "reservar" e "manter a baixa e estornar" é a **decisão 4** da lista
final — e não deve ser tomada dentro desta fase.

---

## D. Contratos

### Payload de sincronização da venda — versionado e compatível

O campo `pagamentos` é **opcional**. Terminal antigo não o envia; servidor
deriva de `forma_pagamento` + `total`, exatamente como o fiscal já faz.

```jsonc
{
  "schema_version": 2,            // 1 continua aceito
  "id": "uuid",
  "total": 150.00,
  "forma_pagamento": "misto",     // mantido por compatibilidade
  "valor_pago": 150.00,           // mantido
  "troco": 0,                     // mantido

  "pagamentos": [                 // OPCIONAL — ausência não é erro
    { "id": "uuid", "forma": "dinheiro", "valor": 50.00,
      "valor_entregue": 100.00, "troco": 50.00 },
    { "id": "uuid", "forma": "credito",  "valor": 100.00 }
  ],
  "terminal_origem_id": "uuid",   // OPCIONAL
  "terminal_recebedor_id": "uuid" // OPCIONAL, só Modelo B
}
```

**Regras do contrato:**

1. `schema_version: 1` (sem `pagamentos`) continua aceito indefinidamente
   durante a Fase 4 — é o que mantém os terminais antigos vendendo.
2. Quando `pagamentos` vem, `sum(valor) = total` é validado; divergência é
   recusa explícita, nunca ajuste silencioso.
3. `id` de cada pagamento vem do cliente — é a chave de idempotência, pelo
   mesmo motivo de `vendas.id` na 0.6D.2.
4. Reenvio do mesmo pagamento devolve `ja_aplicado`; mesmo id com valor
   diferente é `conflito_payload`.

### Contrato futuro do ledger — **não implementado nesta fase**

Quando a 4E chegar:

```
Para cada venda_pagamento com forma ∈ {dinheiro}:
    caixa_movimento (
      caixa_id        = caixa da sessão do terminal recebedor
      tipo            = 'entrada'
      natureza        = 'venda_dinheiro'
      valor           = venda_pagamento.valor      ← aplicado, não entregue
      referencia_tipo = 'venda_pagamento'
      referencia_id   = venda_pagamento.id
      sessao_id       = sessão aberta no momento do recebimento
    )
    UNIQUE (referencia_id) WHERE referencia_tipo = 'venda_pagamento'
```

O índice único é o que garante *"uma única vez"* do teste de ouro — mesmo
padrão de `idx_estoque_mov_venda_item_unico`, já provado na 0.6D.2.

**Formas que NÃO geram movimento de gaveta:** `credito`, `debito`, `pix`,
`carteira`, `marketplace`. O total da venda não é entrada física.

**Carteira:** continua gerando conta a receber pelo trigger atual, e **não**
gera movimento de caixa. Venda de R$ 300 com 100 dinheiro + 100 cartão +
100 carteira produz: venda 300, gaveta +100, conta a receber 100, cartão
fora do ledger. Sem duplicar.

### Configuração por empresa

```
empresa_config_caixa
  empresa_id  uuid PK → empresas
  modo        text CHECK IN ('terminal_individual','caixa_centralizado')
              DEFAULT 'terminal_individual'     ← o modo atual é o padrão
```

`personalizado` (por terminal) fica para depois — precisaria de tabela por
terminal, e nenhuma empresa pediu ainda.

**Default é o comportamento atual.** Empresa que não configurar nada segue
exatamente como hoje.

---

## E. Plano de compatibilidade

Como os PDVs continuam funcionando durante todo o rollout:

| Camada | Garantia |
|---|---|
| **payload** | `pagamentos` opcional; `schema_version: 1` aceito |
| **servidor** | sem `pagamentos`, deriva de `forma_pagamento` + `total` — mesma regra que o fiscal já usa |
| **`forma_pagamento`** | não removido; preenchido com a forma única, ou `misto` quando houver mais de uma |
| **`valor_pago` / `troco`** | não removidos |
| **`vendas.pagamentos`** | continua existindo, agora como projeção — fiscal e carteira intocados |
| **SQLite** | tabela nova; a existente não muda de forma |
| **terminal antigo** | vende, baixa estoque, enfileira e sincroniza sem saber que a Fase 4 existe |

**Teste de retrocompatibilidade obrigatório em toda fase seguinte:**
sincronizar uma venda no formato v1, sem `pagamentos`, e provar que ela é
aceita, que a projeção é gerada, e que nenhum terminal precisou atualizar.

### Identidade do terminal — migração sem quebra

`vendas.terminal_id` é TEXT livre (`PDV-001`, `Caixa`, nulo) e não tem FK.

```
etapa 1  acrescentar vendas.terminal_origem_id uuid NULL → pdv_terminais
etapa 2  o PDV passa a enviar o uuid do terminal autenticado (já o tem no token)
etapa 3  backfill onde for possível casar; o resto fica nulo
etapa 4  terminal_id TEXT permanece, como histórico
```

Nada é removido, nada é inferido. Vendas legadas com terminal nulo
continuam nulas — não se inventa identidade retroativa.

---

## F. Migrations propostas — **nenhuma aplicada**

| # | Migration | Destrutiva? | Quando |
|---|---|---|---|
| 1 | `venda_pagamento` + RLS + grants | não | 4C |
| 2 | trigger de projeção → `vendas.pagamentos` | não | 4C |
| 3 | `vendas.terminal_origem_id` uuid NULL | não | 4D |
| 4 | `empresa_config_caixa` | não | 4D |
| 5 | naturezas `venda_dinheiro`, `recebimento_dinheiro` no CHECK | não (estende) | 4E |
| 6 | `caixa_movimento` único parcial por `referencia_id` | não | 4E |

Todas aditivas. Nenhuma remove coluna, nenhuma reescreve dado histórico,
nenhuma toca as Fases 1–3.

---

## Impacto por camada

**Supabase:** duas tabelas novas, uma coluna nova em `vendas`, um trigger
de projeção, um CHECK estendido. Zero alteração em `vendas`, `venda_itens`,
`contas_receber`, `recebimentos` ou nas tabelas do Caixa.

**SQLite (4C):** tabela local `venda_pagamentos` espelhando o contrato,
gravada na **mesma transação** que já cria venda + itens + estoque + fila —
o padrão que a 0.6D.1 estabeleceu. A tabela `vendas` local não muda de
forma.

**PDV (4C):** o modal de pagamento passa a permitir somar parcelas. É a
única mudança de UI, e ela é aditiva: uma forma só continua sendo um clique.

---

## Riscos

**Crítico**

1. **Regressão do PDV.** Qualquer mudança no payload ou no SQLite pode
   quebrar o balcão. Mitigação: `pagamentos` opcional, `schema_version: 1`
   perpétuo na Fase 4, e teste de retrocompatibilidade como critério de GO.

**Alto**

2. **Divergência entre tabela e projeção.** Duas representações do mesmo
   fato. Mitigação: projeção por trigger, nunca por aplicação, e teste de
   banco provando a igualdade das somas.
3. **Dupla contagem da carteira.** `criar_conta_carteira` já cria conta a
   receber. Mitigação: `carteira` nunca gera movimento de gaveta —
   contratado acima e a ser provado na 4E.
4. **Estoque em `AGUARDANDO_PAGAMENTO`.** Hoje não há reserva. Decisão 4,
   pendente.

**Médio**

5. **`misto` legado.** 12 vendas indetermináveis. Decisão: preservar como
   legado, sem reconstruir e sem movimento retroativo.
6. **Offline no Modelo B.** Limitação aceita: venda em terminal offline não
   chega ao Caixa Principal até sincronizar.
7. **Relatórios por `forma_pagamento`.** Com arrays de verdade, passam a
   subnotificar. Precisam migrar para a projeção na 4F.

---

## Divisão proposta das fases seguintes

| Fase | Escopo | Critério de GO |
|---|---|---|
| **4C** | `venda_pagamento` + projeção + SQLite local + UI de múltiplas formas no PDV | venda v1 antiga sincroniza; venda com 2 formas fecha `sum = total`; offline preservado |
| **4D** | identidade canônica do terminal + `empresa_config_caixa` | terminal antigo sem uuid continua vendendo; default = modo atual |
| **4E** | **integração ao ledger** — só a parcela em espécie | teste de ouro completo; carteira não duplica; retry não duplica |
| **4F** | recebimento de conta antiga no caixa + relatórios pela projeção | quitação em dinheiro exige sessão aberta |
| **4G** | Modelo B: `AGUARDANDO_PAGAMENTO` + estoque comprometido + caixa centralizado | a unidade não é vendida duas vezes; abandono devolve estoque |

O dinheiro só encosta no ledger na **4E**. Até lá, tudo é modelo e
contrato — reversível sem tocar em nenhum saldo.

---

## Decisões de negócio pendentes

Herdadas da 4A e ainda abertas. As três primeiras bloqueiam a 4E; a quarta
bloqueia a 4G.

1. **Carteira:** continua gerando conta a receber automática quando o
   ledger existir? *Proposta: sim, e nunca gera movimento de gaveta.*
2. **`misto` legado:** preservar sem reconstruir? *Proposta: sim.*
3. **Recebimento de conta antiga:** exige sessão aberta? *Proposta: sim
   para espécie; outras formas a analisar.*
4. **Estoque em `AGUARDANDO_PAGAMENTO`:** reservar ou manter a baixa e
   estornar? *Sem proposta — precisa de decisão sua.*
5. **`vendas.terminal_id`:** migrar para uuid mantendo o TEXT? *Proposta:
   sim, aditivo, sem backfill inventado.*
6. **Prazo de expiração** de uma venda aguardando pagamento? *Sem proposta.*
