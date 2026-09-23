# Fase 3 — Homologada de ponta a ponta

**22/09/2026 · GO**

Sessão de caixa executada pela interface autenticada, em produção, do
início ao fim: abertura com fundo da tesouraria, suprimento, sangria,
fechamento com falta e conferência física, e a abertura seguinte herdando o
troco. Todos os registros **permanecem no ledger** — são lançamentos
legítimos, e apagá-los contradiria o append-only que a fase sustenta.

## Ambiente

| | |
|---|---|
| Execução | interface autenticada, pelo operador |
| Empresa | Bazar Eficaz `a1000000-0000-0000-0000-000000000001` |
| Usuário | Administrador Bazar Eficaz `e06647ed-3995-423d-9fe8-64fb21b69a77` |
| Terminal | YOGA `a3c2f27c-c6b5-4a8b-885c-9f918c0d9181` |
| Caixa | Caixa YOGA `4ad41b7c-b1ba-4f2d-99c1-f5db038fa327` |

## O cenário

```
Tesouraria 0
  → abertura do YOGA com 100 vindos da Tesouraria
  → suprimento  +20
  → sangria     −30
  → esperado     90
  → contado      85
  → falta        −5
  → mantém       50 de troco
  → entrega      35 à Tesouraria
  → fecha a sessão
  → ledger do YOGA permanece em 50
  → nova sessão abre com origem HERDADO
  → fundo inicial 50
  → zero movimento financeiro na herança
```

## Sessão 1 — `84b59cd5-de24-447b-9b92-e1848538fc85`

Aberta 17:33:41 BRT, fechada 18:18:24 BRT, ambas pelo Administrador.

| | |
|---|---|
| `fundo_origem` | tesouraria |
| `fundo_inicial` | 100,00 |
| `fundo_transferencia_id` | `ee53070c-…186e71f30ee1` |
| `valor_esperado` | 90,00 |
| `valor_contado` | 85,00 |
| `diferenca` | **−5,00** (falta) |
| `valor_mantido_troco` | 50,00 |
| `valor_entregue_tesouraria` | 35,00 |
| `fechamento_transferencia_id` | `1395e412-…084f7896ca91` |

Ledger da gaveta, movimento a movimento:

```
sangria              −10,00   (Fase 2, sem sessão)   →   −10,00
suprimento           +10,00   (Fase 2, sem sessão)   →     0,00
suprimento          +100,00   abertura               →   100,00
suprimento           +20,00   suprimento             →   120,00
sangria              −30,00   sangria                →    90,00  ← esperado
diferenca_fechamento  −5,00   conferência            →    85,00  ← contado
sangria              −35,00   entrega final          →    50,00  ← troco
```

## Sessão 2 — `8f0db9be-4284-48ab-9f68-493354766485`

Aberta 21:00:20 BRT, origem **herdado**, `fundo_inicial` **50,00**,
`fundo_transferencia_id` **NULL**.

**A fonte autoritativa foi o saldo atual do ledger, não uma cópia de
`valor_mantido_troco` da sessão anterior.** Os dois valem 50,00 neste
cenário, mas são coisas diferentes: `abrir_caixa_sessao_v1` chama
`saldo_caixa_v1(caixa_id)` e recusa qualquer valor divergente com
`fundo_herdado_divergente`. Se houvesse movimento administrativo entre o
fechamento e a abertura, o herdado acompanharia o ledger e não o campo da
sessão anterior — há teste de regressão para exatamente isso.

## A prova principal

| | antes da abertura herdada | depois |
|---|---|---|
| transferências | 6 | **6** |
| movimentos | 13 | **13** |
| saldo do Caixa YOGA | 50,00 | **50,00** |
| saldo da Tesouraria | −55,00 | **−55,00** |

**Abertura herdada cria sessão, e só.** Não cria movimento, não cria
transferência, não cria `fundo_abertura`, não gera ajuste.

O relógio confirma sozinho: o último movimento do YOGA é de **18:18:24** (o
fechamento) e a sessão nova abriu às **21:00:20** — quase três horas
depois, sem nada entre os dois.

Auditoria: `caixa_sessao_aberta` às 21:00:20 com `fundo_origem: herdado` e
`fundo_inicial: 50` — registro administrativo, sem lançamento financeiro
correspondente. Nenhum estorno em toda a homologação.

## Dois bugs encontrados e corrigidos durante a homologação

**1. Sangria e suprimento não revalidavam o card do PDV** — corrigido em
`2110ba3`.

O modal vivia no componente pai, que recarregava só tesouraria e extrato. O
caminho pai → filho não existia, e `CaixasPdvClient` carregava uma vez no
`useEffect` com dependências vazias. O card ficava com o esperado velho até
um F5. Resolvido com um contador de revalidação que desce do pai; o filho
relê o estado do servidor quando ele muda. Nada é recalculado no frontend, e
a revalidação é só GET.

**2. Abertura herdada mostrava R$ 0,00 com a gaveta fechada** — corrigido em
`d722be1`.

O saldo só era calculado quando havia sessão **aberta**
(`c && s ? … : null`), e a herança acontece justamente com a gaveta
**fechada**. O campo vinha nulo e o modal o convertia em zero. A regra
server-side estava correta e teria recusado com
`fundo_herdado_divergente`, mas o efeito era pior que um número errado:
abrir por herança nunca teria funcionado. O saldo passou a ser calculado
para toda gaveta existente, o campo virou `saldo_gaveta` — uma fonte só — e
o modal deixou de confundir "carregando", "falhou" e "zero".

Os dois foram encontrados **antes** de qualquer registro incorreto entrar no
ledger, porque a homologação foi feita em checkpoints curtos.

## Decisão de negócio homologada

**`diferenca_fechamento` é movimento próprio do ledger.**

- sobra = **entrada**
- falta = **saída**
- **não** é receita nem despesa operacional: é diferença apurada na
  conferência física
- fica **vinculada à sessão**, com usuário e empresa
- **nunca** altera movimento anterior para o saldo bater

É o que faz o ledger terminar representando o dinheiro que estava
fisicamente na gaveta — e é isso que permite a sessão seguinte herdar sem
inventar dinheiro.

## O que continua não provado

**Concorrência real entre duas sessões.** O MCP serializa as chamadas — a
sessão B esperou 0,00 s por um lock que A segurou por 4 s. O
`pg_advisory_xact_lock` está no código e o raciocínio é o mesmo validado na
0.6D.2, mas a prova empírica segue pendente desde aquela fase.

A homologação não exercitou duplo clique, timeout, payload conflitante nem
rollback: foram cobertos de forma controlada, e provocá-los em produção foi
explicitamente descartado.
