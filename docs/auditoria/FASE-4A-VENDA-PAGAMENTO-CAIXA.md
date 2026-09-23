# Fase 4A — Auditoria: venda → pagamento → caixa

**23/09/2026 · somente auditoria.** Nada foi implementado, nenhuma migration
criada, nenhum comportamento alterado.

Bases auditadas: `vargasnexus-pdv` em `codex/0.6d.3b-venda-v1` (`ea8ad6d`,
v1.10.5 — a mesma instalada no terminal YOGA) e `pdv-vargas-web` em
`origin/main` (`d901d6a`), mais o schema real do Supabase
`ntwfkmwprjciucydedku`.

---

## Resumo executivo

Três achados mudam o planejamento da Fase 4B.

**1. O PDV oferece "Misto", mas não registra a composição.** A premissa de
que "o PDV não permite múltiplas formas" está incorreta na letra e correta
no efeito: existe o botão `Misto` (tecla 6), ele grava
`forma_pagamento='misto'` — e **nenhum valor por forma é coletado**. Há 12
vendas assim em produção. Para essas, *quanto entrou em dinheiro é
desconhecido*, e nenhum ledger consegue derivá-lo.

**2. O modelo 1→N já existe parcialmente, e já é consumido.** A coluna
`vendas.pagamentos` (jsonb) existe, está preenchida em 30 vendas com o
formato `[{"forma": "...", "valor": ...}]`, e **dois consumidores já a leem
corretamente com fallback**: a emissão de NFC-e e o trigger
`criar_conta_carteira`, que soma a parcela em carteira do array. O que falta
não é o modelo — é o PDV preenchê-lo e alguém somar a parcela em dinheiro.

**3. Venda em carteira já produz efeito financeiro automático.** O trigger
`trg_venda_carteira` cria `contas_receber` e incrementa
`clientes.saldo_devedor` a cada venda com carteira. É o único efeito
financeiro automático existente, e é o principal candidato a dupla
contabilização quando o ledger passar a ser alimentado.

E uma limitação dura: **não existe comunicação terminal-a-terminal**. Um
Balcão offline é invisível para o Caixa Principal até voltar à rede.

---

## A. Fluxo atual

```
   ┌────────────────────────── TERMINAL (Electron) ──────────────────────────┐
   │  pdv.js  _confirmarPagamento()  →  finalizar()                          │
   │     escolhe UMA forma (payMethod)                                       │
   │     só 'dinheiro' abre campo de valor recebido → troco                  │
   │                    ↓                                                    │
   │  database.js  vendas.registrar()   ── UMA transação SQLite ──           │
   │     INSERT vendas  (forma_pagamento, valor_pago, troco)                 │
   │     INSERT venda_itens                                                  │
   │     UPDATE estoque            ← A BAIXA ACONTECE AQUI                   │
   │     INSERT movimentacoes_estoque                                        │
   │     INSERT credito_movimentacoes   (se carteira)                        │
   │     INSERT sync_queue              ← fila LOCAL                         │
   └─────────────────────────────────────────────────────────────────────────┘
                                ↓  quando houver rede
   ┌──────────────────────── SINCRONIZAÇÃO (sync.js) ────────────────────────┐
   │  _arbitrarAntesDeSubir  →  negociação v1 × legado  (0.6D.3B)            │
   │     v1     : POST /api/pdv/vendas/sincronizar-v1 → RPC transacional     │
   │     legado : api.registrarVenda → insert direto + itens + estoque       │
   └─────────────────────────────────────────────────────────────────────────┘
                                ↓
   ┌──────────────────────────── SUPABASE ───────────────────────────────────┐
   │  vendas  ← trg_venda_carteira → contas_receber + clientes.saldo_devedor │
   │  venda_itens · estoque_movimentacoes · produtos.estoque                 │
   │                                                                         │
   │  NENHUM movimento em caixa / caixa_movimento / caixa_sessao             │
   └─────────────────────────────────────────────────────────────────────────┘
```

---

## B. A venda

**Nasce** em `src/renderer/pages/pdv.js`, na função de finalização (~linha
1750), como objeto montado a partir do carrinho. **Termina** em
`src/main/database.js` → `vendas.registrar()`, dentro de uma transação
SQLite.

Schema local (`database.js`):

```sql
CREATE TABLE vendas (
  id TEXT PRIMARY KEY,          -- uuid gerado no terminal
  remote_id TEXT UNIQUE,        -- preenchido após sincronizar
  numero INTEGER,               -- sequencial com base no terminal
  cliente_id, empresa_id, deposito_id,
  operador_id, operador_nome, vendedor_id, vendedor_nome, vendedor_codigo,
  status TEXT DEFAULT 'concluida',   -- concluida | cancelada | pendente
  subtotal, desconto, total,
  forma_pagamento TEXT,         -- UMA só
  valor_pago REAL, troco REAL,
  created_at, synced_at, sync_status
);
```

**Não existe `terminal_id` na tabela local.** Ele é acrescentado só no
envio, a partir de `store.get('config.terminal_id')`.

**Status possíveis hoje:** `concluida`, `cancelada`, `pendente`. Não existe
nada equivalente a "aguardando pagamento": toda venda finalizada nasce
`concluida`.

---

## C. O pagamento

### A resposta à pergunta crítica

**O pagamento está embutido na venda. Não existe entidade de pagamento** —
nem no SQLite, nem no Supabase (`pg_tables` não tem nenhuma tabela
`pagamento*`).

Três campos carregam tudo:

| Campo | O que guarda |
|---|---|
| `forma_pagamento` | uma string: `dinheiro`, `pix`, `credito`, `debito`, `carteira`, `misto`, `devolucao`, `marketplace` |
| `valor_pago` | o que o cliente entregou (só significativo em dinheiro) |
| `troco` | calculado **só** para `dinheiro` puro |

### Como cada modalidade é representada

| Modalidade | Representação | Observação |
|---|---|---|
| dinheiro | `forma_pagamento='dinheiro'`, `valor_pago` do campo, `troco = valor_pago − total` | única com coleta de valor |
| PIX | só o rótulo | sem txid, sem confirmação |
| débito / crédito | só o rótulo | **sem adquirente, NSU, autorização ou bandeira** |
| carteira | rótulo + `usa_credito=true` | dispara o trigger de conta a receber |
| **misto** | **só o rótulo** | **nenhuma decomposição é coletada** |

### O ponto mais grave

```js
// pdv.js:1301 e 1341 — só dinheiro abre o campo de valor
extra.innerHTML = method === 'dinheiro' ? _trocoHtml(getTotal()) : ''
```

Escolher "Misto" não abre formulário nenhum. A venda sai com
`forma_pagamento='misto'` e um `valor_pago` único. **A composição nunca
existiu.** São 12 vendas assim em produção, e para nenhuma delas é possível
dizer quanto foi dinheiro.

### O que já existe do lado certo

`vendas.pagamentos` (jsonb) está preenchida em **30 vendas**, todas com
`terminal_id` nulo — ou seja, criadas pela Web, não pelo PDV. Formato:

```json
[{"forma": "dinheiro", "valor": 225}]
```

Todas com **um único elemento**. E dois consumidores já a tratam
corretamente:

```ts
// src/lib/fiscal/emitirParaVenda.ts:253
const pagamentosBrutos =
  Array.isArray(venda.pagamentos) && venda.pagamentos.length > 0
    ? venda.pagamentos
    : [{ forma: venda.forma_pagamento, valor: Number(venda.total) }]
```

```sql
-- trigger criar_conta_carteira
SELECT sum((p->>'valor')::numeric) INTO v_valor
FROM jsonb_array_elements(COALESCE(NEW.pagamentos, '[]')) p
WHERE p->>'forma' = 'carteira';
IF v_valor IS NULL AND NEW.forma_pagamento = 'carteira' THEN
  v_valor := NEW.total;      -- fallback
END IF;
```

**Este é o padrão a seguir para o dinheiro.** A NFC-e e a carteira já sabem
somar a parcela que lhes interessa; o ledger precisará fazer o mesmo.

---

## D. Estoque — o momento exato da baixa

**Na finalização, no terminal, dentro da mesma transação SQLite que cria a
venda.** Não ao adicionar item, não ao sincronizar.

```
vendas.registrar()  ── db.transaction ──
  INSERT vendas
  INSERT venda_itens
  UPDATE estoque SET quantidade = quantidade - item.quantidade
  INSERT movimentacoes_estoque
  INSERT sync_queue
```

No servidor há uma **segunda** baixa, sobre `produtos.estoque` — não é
dupla contagem: são dois espelhos do mesmo saldo (SQLite local e Supabase),
e a 0.6D.2 tornou a remota idempotente por
`idx_estoque_mov_venda_item_unico`.

| Evento | Efeito no estoque |
|---|---|
| finalizar | baixa local imediata + baixa remota na sincronização |
| editar venda | estorna os itens antigos e baixa os novos (`database.js:138-151`) |
| cancelar | estorna |
| devolução | venda com `forma_pagamento='devolucao'` e crédito ao cliente |
| falha de sync | o estoque local **já baixou**; o remoto espera na fila |

**Consequência direta para um futuro `AGUARDANDO_PAGAMENTO`:** hoje o
estoque sai no instante da finalização. Se uma venda ficasse 5, 10 ou 30
minutos aguardando recebimento, o estoque **já estaria baixado** esse tempo
todo, e um cancelamento por não-pagamento exigiria estorno. Não há reserva
— existe baixa.

---

## E. Offline — a limitação real

Cada terminal tem **seu próprio SQLite** e **sua própria `sync_queue`**. A
única comunicação externa é com o Supabase (`supabaseClient.js`, WebSocket
do Realtime). **Não há peer-to-peer, mDNS, broadcast ou servidor local.**

### O cenário perguntado

> Balcão 01 offline cria venda de R$ 250 que deveria ser paga no Caixa
> Principal. O Caixa Principal consegue conhecer essa venda?

**NÃO.** Declaro explicitamente: com a arquitetura atual, enquanto o Balcão
01 estiver sem rede, a venda existe **apenas** no SQLite daquela máquina.
Não há caminho — nem pelo servidor, nem pela rede local — para o Caixa
Principal tomar conhecimento dela.

Qualquer modelo de caixa centralizado que dependa de o terminal vendedor
estar offline é, hoje, impossível. Isso não é um defeito a corrigir nesta
fase: é a limitação que a Fase 4B precisa enfrentar de olhos abertos.

O que funciona offline: criar a venda, baixar estoque local, imprimir,
enfileirar. O que não funciona: qualquer coisa que outro terminal precise
ver.

---

## F. Identidade do terminal

**Existem duas identidades de terminal, desconexas.**

| | Origem | Tipo | Onde vive |
|---|---|---|---|
| **operacional** | `store.get('config.terminal_id')`, fallback `'PDV-001'` | **TEXT livre** | `vendas.terminal_id` |
| **autenticada** | ativação da 0.6A | **UUID** | `pdv_terminais.id`, no token |

Valores reais em `vendas.terminal_id`: `PDV-001`, `PDV-002`, `PDV-003`,
`PDV-004`, `PDV-010`, `Caixa`, e **nulo**. Não há FK para `pdv_terminais`.

A identidade que sobrevive `PDV → SQLite → sync → API → Supabase` é a
**operacional** — uma string que o próprio terminal escolhe. A autenticada
protege a rota, mas **não é gravada na venda**.

O que a venda identifica hoje: quem vendeu (`vendedor_*`), quem operou
(`operador_*`), a empresa e o terminal **como texto**.

O que a venda **não** identifica: qual caixa físico, qual sessão, quem
recebeu.

> **A distinção que a Fase 4B precisa:** `vendas.terminal_id` é o *terminal
> de origem*. Não existe hoje nenhum campo para *terminal recebedor*, nem
> para *caixa* ou *sessão* que receberia o pagamento.

---

## G. Contas a receber

| Tabela | Campos relevantes | Terminal / caixa / sessão |
|---|---|---|
| `contas_receber` | `origem`, `origem_id`, `valor_original`, `valor_recebido`, `valor_aberto`, `status`, `forma_prevista`, `operador_nome` | **nenhum** |
| `recebimentos` | `conta_id`, `cliente_id`, `valor`, `desconto`, `juros`, `multa`, `valor_liquido`, `forma_pagamento`, `conta_destino`, `operador_nome`, `data_recebimento` | **nenhum** |

Formas usadas em `recebimentos`: `dinheiro`, `pix`, `credito`, `debito`.
Sem `misto`.

Medições em produção: **140 recebimentos**, apenas **4** com
`operador_nome`, e **0** com `conta_destino` — o campo existe e nunca foi
preenchido.

**O evento que a Fase 4B precisa suportar** — cliente quita R$ 200 de
dívida antiga em dinheiro — já é registrado em `recebimentos` com
`forma_pagamento='dinheiro'`. O que falta é: **qual gaveta recebeu**. Sem
terminal, caixa ou sessão, não há como saber em qual caixa físico aqueles
R$ 200 entraram.

---

## H. Efeitos financeiros já existentes

Levantados por inspeção dos triggers de `vendas` e do código de
sincronização.

| Efeito | Onde | Risco de dupla contabilização |
|---|---|---|
| **`trg_venda_carteira` → `criar_conta_carteira`** | trigger em `vendas` | **ALTO.** Cria `contas_receber` e incrementa `clientes.saldo_devedor` a cada venda em carteira. Se o ledger também registrar a venda, o valor conta duas vezes. |
| `credito_movimentacoes` no PDV | `database.js` (registro local) | médio — espelho local do crédito |
| `clientes.saldo_devedor` | UPDATE no mesmo trigger | **saldo em coluna** — o anti-padrão que o módulo de Caixa combate, e que já existe |
| `recebimentos` → baixa em `contas_receber` | Web | médio — é dinheiro entrando sem ledger |

**A RPC `sincronizar_venda_pdv_v1` NÃO toca em caixa, caixa_movimento,
caixa_sessao, contas_receber nem creditos_cliente.** Verificado por leitura
do corpo da função em produção. A venda sincronizada não produz efeito
financeiro nenhum — o que é exatamente o que torna a Fase 4B possível sem
desfazer nada.

**Nenhuma venda produz movimento de caixa hoje.** O ledger da Fase 1–3 está
completamente desacoplado das vendas.

---

## I. Matriz dos cenários — comportamento atual

| | Cenário | Comportamento atual comprovado |
|---|---|---|
| **A** | Vende R$ 100 em dinheiro | `forma_pagamento='dinheiro'`, `valor_pago` do campo, troco calculado. Estoque baixa local. **Zero efeito no caixa.** |
| **B** | R$ 40 dinheiro + R$ 60 cartão | **Não é representável.** O operador escolhe uma forma. Se escolher `misto`, grava o rótulo sem a composição. |
| **C** | Terminal vende, outro deveria receber | **Não existe.** Não há campo de terminal recebedor; a venda nasce `concluida` e paga. |
| **D** | Venda criada offline | Funciona: SQLite local, estoque baixa, fila espera rede. |
| **E** | Offline num terminal, receber em outro | **Impossível.** Sem peer-to-peer, o outro terminal não vê a venda até o primeiro sincronizar. |
| **F** | Cancelada após finalizar | `status='cancelada'`, estoque estornado. Sem efeito de caixa (não há). |
| **G** | Estorno de pagamento | **Não existe como conceito.** Não há entidade de pagamento para estornar — só cancelar a venda inteira. |
| **H** | Conta antiga paga em dinheiro | Registra `recebimentos` com forma `dinheiro`, baixa `contas_receber`. **Sem terminal, sem caixa, sem ledger.** |
| **I** | Usuário troca de terminal | `operador_*` vem da sessão do PDV; `terminal_id` vem da config da máquina. Independentes — funciona, mas nada liga o operador a uma gaveta. |
| **J** | Terminal de outra empresa | `empresa_id` vem de `auth.usuario.empresa_estoque_id`; as rotas protegidas (0.6A) forçam a empresa do token. Venda de outra empresa é barrada na rota, não no terminal. |
| **K** | R$ 50 dinheiro + R$ 100 crédito | Como **B**: não representável. |
| **L** | R$ 50 + R$ 100 PIX + R$ 150 crédito | Idem. `misto` não decompõe. |
| **M** | R$ 100 cartão + R$ 50 dinheiro, cliente dá R$ 100, troco R$ 50 | **Não representável.** `troco` só é calculado quando `payMethod === 'dinheiro'` (pdv.js:1776); em `misto`, troco = 0. Não há como distinguir *valor entregue* de *valor aplicado à venda*. |
| **N** | Dois cartões (R$ 200 + R$ 300) | **Não representável.** Um único rótulo, sem adquirente, NSU ou autorização — dois cartões seriam indistinguíveis mesmo com o array preenchido. |

---

## J. Pontos de acoplamento

Onde uma arquitetura futura poderia se conectar — **identificação apenas**.

| # | Ponto | Por que é candidato |
|---|---|---|
| 1 | `vendas.pagamentos` (jsonb) | O modelo 1→N já existe e já tem dois leitores com fallback correto |
| 2 | `criar_conta_carteira` | Já soma a parcela de uma forma específica do array — o molde exato para somar a parcela em dinheiro |
| 3 | `emitirParaVenda.ts:253` | A NFC-e já emite com múltiplos pagamentos |
| 4 | `sincronizar_venda_pdv_v1` | Transacional e idempotente; não toca financeiro — daria para acrescentar o efeito de caixa dentro da mesma transação |
| 5 | `caixa_sessao` + `caixa_movimento` | Já têm `sessao_id` nullable e naturezas preparadas (`venda_dinheiro`, `recebimento_dinheiro`, `devolucao_dinheiro`, `pagamento_dinheiro` já classificadas no motor) |
| 6 | `recebimentos` | Precisaria de terminal/caixa/sessão para ligar a quitação ao ledger |
| 7 | `contextoCaixa` | Já resolve empresa ativa e permissão server-side |
| 8 | `config.terminal_id` × `pdv_terminais.id` | A ponte entre as duas identidades teria de ser feita aqui |

---

## K. Riscos

### Crítico

1. **`misto` sem composição.** 12 vendas em produção onde a parcela em
   dinheiro é indeterminável. Qualquer ledger alimentado por vendas
   precisará decidir o que fazer com elas — e não há resposta derivável dos
   dados.
2. **Dupla contabilização pela carteira.** `trg_venda_carteira` já cria
   conta a receber automaticamente. Somar a venda ao ledger sem tratar isso
   conta o mesmo dinheiro duas vezes.

### Alto

3. **Duas identidades de terminal desconexas.** `vendas.terminal_id` é TEXT
   livre com fallback `'PDV-001'`, sem FK. Ligar venda a caixa exige
   resolver essa ponte, e há vendas com terminal nulo.
4. **Offline impede caixa centralizado.** Sem peer-to-peer, o Modelo B só
   funciona com o terminal vendedor online.
5. **Estoque baixa na finalização.** Um estado `AGUARDANDO_PAGAMENTO`
   manteria estoque baixado por tempo indeterminado, sem reserva.

### Médio

6. **`recebimentos` sem terminal/caixa.** 140 registros, 0 com
   `conta_destino`. A quitação em dinheiro não tem como apontar a gaveta.
7. **`clientes.saldo_devedor` é saldo em coluna** — o anti-padrão que o
   módulo de Caixa evita, já em produção.
8. **Sem dados de adquirente.** Nenhum NSU, autorização ou bandeira — dois
   cartões seriam indistinguíveis.

### Baixo

9. **Relatórios agrupam por `forma_pagamento`.** `components.js:1198-1199`
   (PDV) e `dashboard/vendas` somam por forma única; com o array
   preenchido, passariam a subnotificar.
10. **Impressão mostra uma forma.** `pdv.js:2074` imprime
    `forma_pagamento.toUpperCase()`.

---

## Perguntas que precisam de decisão de negócio

1. **As 12 vendas com `misto` em produção** — deixar como estão (e o ledger
   as ignora), ou reconstituir a composição manualmente?
2. **A carteira continua gerando conta a receber automática** quando o
   ledger existir, ou passa a ser responsabilidade do novo fluxo? As duas
   coisas juntas duplicam.
3. **Modelo B com terminal offline** — o caixa centralizado exige o
   vendedor online? Ou a venda offline fica retida até sincronizar?
4. **`AGUARDANDO_PAGAMENTO` e o estoque** — reservar em vez de baixar, ou
   manter a baixa e aceitar o estorno no cancelamento?
5. **Qual identidade de terminal passa a valer** — migrar
   `vendas.terminal_id` para o UUID de `pdv_terminais`, ou manter as duas?
6. **Recebimento de conta antiga** — exige sessão de caixa aberta, ou pode
   cair num caixa administrativo?
