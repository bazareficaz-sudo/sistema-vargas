# Fase 0.6C.6 — Gate 0: auditoria da conversão orçamento → venda

**Data:** 11/09/2026 · **Auditoria apenas. Nada alterado.**
Nenhum código, migration, banco, flag, RLS, grant, release, deploy ou push.

---

## 1. O fluxo atual, ponta a ponta

| # | Passo | Onde | Auth | Transacional | Idempotente | Erro chega ao usuário? |
|---|---|---|---|---|---|---|
| 1 | `converterEmVenda(id)` classifica o documento | renderer | — | — | — | sim |
| 2 | `PDV.carregarDoOrcamento(orc)` enche o carrinho | renderer | — | — | — | sim |
| 3 | `window._orcamentoParaConverter = orc.id` | renderer, **memória** | — | **não** | — | — |
| 4 | operador finaliza a venda | renderer | — | — | — | sim |
| 5 | `db.vendas.registrar(venda)` | **SQLite** | — | **SIM** | não | sim |
| 6 | fila recebe `{venda_id}` | SQLite, mesma transação | — | sim | — | — |
| 7 | `marcarConvertido(orc.id)` | SQLite + `anon` | **anon** | **não** | não | **NÃO** |
| 8 | fila drena → `api.registrarVenda` | Supabase | **anon** | **não** | não | parcial |
| 9 | `insert vendas` | Postgres | anon | sim (statement) | heurística | via 8 |
| 10 | triggers da venda | Postgres | — | **sim** | sim (guarda) | via 8 |
| 11 | `insert venda_itens` | Supabase | anon | **não** | **não** | **NÃO** (só `console.warn`) |
| 12 | `_ajustarEstoqueCAS` por item | Supabase | anon | **não** | CAS | parcial |

O passo 5 é a única fronteira transacional real, e ela é **local**: venda, itens,
baixa de estoque, movimentação, crédito do cliente e a entrada na fila commitam
juntos no SQLite.

Do passo 8 em diante são **três ou mais requisições HTTP independentes**.

## 2. Trechos exatos

**`src/renderer/pages/pdv.js:2497`** — o vínculo nasce e vive em memória:
```js
window._orcamentoParaConverter = orc.id;
```

**`src/renderer/pages/pdv.js:1806-1808`** — e morre engolido:
```js
if (window._orcamentoParaConverter) {
  window.pdv.orcamentos.marcarConvertido(window._orcamentoParaConverter).catch(() => {});
```

**`src/main/main.js:506-513`** — reconfirmado em **1.9.9**, sem alteração:
```js
ipcMain.handle('orcamentos:marcarConvertido', async (_, id) => {
  db.orcamentos.marcarConvertido(id);
  const orc = db.orcamentos.getById(id);
  if (orc?.remote_id) {
    try { await api.atualizarStatusOrcamento(orc.remote_id, 'convertido'); } catch {}
  }
  return { ok: true };
});
```

**`src/main/api.js`** — `atualizarStatusOrcamento` é `supabase.from('orcamentos').update({status})`
pelo `anon`, fora do `orcamentoComando`, sem `registrarFallback`, sem revisão.

## 3. Como o estado inconsistente acontece

```
venda COMMITADA no SQLite (passo 5)
        ↓
marcarConvertido dispara (passo 7)
        ↓
falha de rede / anon recusa / app fecha
        ↓
`catch {}` no main  +  `.catch(() => {})` no renderer
        ↓
VENDA EXISTE · ORÇAMENTO CONTINUA ABERTO · NINGUÉM SABE
```

São **quatro** formas de perder o passo 7, e nenhuma produz aviso:

1. `.catch(() => {})` no renderer;
2. `catch {}` no main;
3. `window._orcamentoParaConverter` é memória do renderer — **um F5, um crash ou
   navegar para outra tela antes de finalizar apaga o vínculo**;
4. `marcarConvertido` não entra na fila: não há retry.

O passo 3 é o mais grave e não estava no levantamento anterior: o vínculo entre
o orçamento e a venda **não existe em disco em momento nenhum**.

## 4. Efeitos de criar uma venda

### No SQLite (transacional, um `db.transaction`)

| Efeito | Classificação |
|---|---|
| `INSERT vendas` | obrigatório dentro da atomicidade |
| `INSERT venda_itens` | obrigatório |
| `UPDATE estoque` (baixa) | obrigatório |
| `INSERT movimentacoes_estoque` | obrigatório |
| saldo de crédito do cliente + `credito_movimentacoes` | obrigatório, quando aplicável |
| `INSERT sync_queue` | obrigatório |

### No Postgres

| Efeito | Como | Classificação |
|---|---|---|
| `redirecionar_cliente_mesclado` | trigger BEFORE INSERT | derivado, transacional |
| **`bloquear_venda_duplicada`** | trigger BEFORE INSERT | ver §5 |
| **`criar_conta_carteira`** → `contas_receber` | trigger AFTER INSERT | **derivado, transacional e já idempotente** (`IF EXISTS origem_id = NEW.id`) |
| `sincronizar_saldo_devedor_cliente` | trigger em `contas_receber` | derivado, transacional |
| `venda_itens` | insert separado do cliente | **fora da atomicidade** |
| estoque (`_ajustarEstoqueCAS`) | N chamadas separadas, CAS por item | **fora da atomicidade** |

**Boa notícia:** o efeito financeiro já é transacional com o insert da venda e já
é idempotente. **Má notícia:** itens e estoque no servidor não são.

Não foram encontrados efeitos fiscais, de comissão ou de marketplace disparados
pela criação da venda. `entregas` é chamada separada, condicional e opcional.

## 5. Estado atual da idempotência

### Não existe vínculo orçamento → venda. Em lugar nenhum.

```
vendas (Postgres) ...... 49 colunas, NENHUMA referencia orçamento
orcamentos (Postgres) .. nenhuma coluna de venda
vendas (SQLite) ........ nenhuma
orcamentos (SQLite) .... nenhuma
```

A unidade de negócio que a fase quer garantir — *"este orçamento originou
exatamente esta venda"* — **não é representável no schema atual**. Sem ela, não
há chave para idempotência de conversão: não dá para perguntar "já converti?",
só "o status está convertido?", que não diz em que venda.

### O que existe

`trg_bloquear_venda_duplicada`, BEFORE INSERT em `vendas`:

- mesma `empresa_id` + mesmo `numero` + mesmo `total`, **janela de 2 minutos**;
- registra em `vendas_duplicidade_bloqueada` e **`return null`** — descarta em
  silêncio, de propósito (o comentário diz: devolver erro faria o operador
  lançar de novo);
- **medido: 0 linhas em `vendas_duplicidade_bloqueada`.** Nunca disparou.

É heurística de proteção contra duplo envio, **não idempotência**: não tem
chave de operação, não sobrevive a 2 minutos, e o cliente que for descartado
recebe erro do `.single()` — a venda fica local em "Pendente".

## 6. Cenários A–H, comportamento HOJE

| | Cenário | O que acontece hoje |
|---|---|---|
| A | duplo clique em **Converter** | inofensivo — só recarrega o carrinho; a venda ainda não existe |
| A' | duplo clique em **finalizar venda** | **não auditado a fundo** — não encontrei guarda explícita em `finalizarVenda`; a proteção seria o trigger de 2 min, que nunca disparou |
| B | timeout depois de criar a venda | venda existe local e no servidor; o cliente vê erro; a fila retenta; `remote_id` pode não gravar |
| C | resposta HTTP perdida | mesma coisa — retry reenviaria a venda; só o trigger de 2 min separa duplicata de reenvio |
| D | app fecha depois do COMMIT local | venda persiste; **`_orcamentoParaConverter` é memória e some** → orçamento nunca é convertido |
| E | retry da fila | reenvia `registrarVenda` inteira; estoque via CAS não duplica, itens podem |
| F | A e B convertem o mesmo orçamento | **duas vendas**. Nada impede: números diferentes, totais possivelmente iguais mas fora da janela, e nenhum vínculo |
| G | documento alheio convertido | **bloqueado desde a 0.6C.5** (`podeConverter` recusa snapshot alheio) |
| H | offline | venda é criada localmente e fica na fila; `marcarConvertido` falha em silêncio; orçamento fica aberto |

**F é o mais grave**, e é exatamente o que a fase existe para impedir.

## 7. Fronteira transacional — a hipótese do prompt não cabe hoje

A hipótese era `converter_orcamento_em_venda(...)` como **uma operação
server-side** que cria a venda e converte o orçamento num `BEGIN/COMMIT`.

Ela é o desenho certo, e **não é implementável nesta fase**, por três razões
medidas:

1. **A venda nasce no SQLite, não no servidor.** `db.vendas.registrar` commita
   localmente e a fila envia depois. O PDV é offline-first por desenho: a venda
   precisa existir com a internet caída. Uma RPC server-side só poderia ser a
   autoridade se `registrarVenda` fosse invertida — e migrar `registrarVenda`
   está explicitamente fora do escopo.
2. **Não existe o vínculo.** Sem `orcamento_id` em `vendas`, a RPC não teria
   como devolver "já convertido → venda X", que é metade do valor da operação.
3. **Itens e estoque do lado servidor não são transacionais.** Trazer a venda
   para dentro de uma RPC exigiria mover `venda_itens` e o ajuste de estoque
   para dentro dela — o que é reescrever `registrarVenda`.

### A menor fronteira segura

Dividir, como você suspeitou:

**0.6C.6A — o vínculo e a chave.** Sem mudar comportamento de venda:

- coluna `orcamento_id` em `vendas` (Postgres e SQLite), mais `UNIQUE` parcial
  por empresa: um orçamento origina no máximo uma venda, garantido pelo banco;
- `orcamentos.venda_id` para o caminho inverso;
- a conversão passa a gravar o vínculo **dentro da transação local** que já
  existe (`db.vendas.registrar`), eliminando o passo 3 em memória;
- `marcarConvertido` sai do `anon` e entra no `orcamentoComando`, com chave
  derivada do vínculo, fila, retry e telemetria — como `salvar` e `cancelar`;
- operação `orcamentos.converter` em `pdv_operacoes`.

Isso sozinho já mata os defeitos 1–4 do §3 e o cenário F, porque o `UNIQUE` no
banco passa a ser a autoridade.

**0.6C.6B — a atomicidade real.** Só faz sentido depois que `registrarVenda`
for migrada, porque é ela que decide onde a venda nasce. Aí sim a RPC única.

## 8. Migrations necessárias (0.6C.6A)

```sql
alter table vendas add column orcamento_id uuid references orcamentos(id);
create unique index vendas_orcamento_unico
    on vendas (orcamento_id) where orcamento_id is not null;
alter table orcamentos add column venda_id uuid;   -- caminho inverso, sem FK
```

E a migration local equivalente em `database.js`.

Nenhuma delas altera comportamento existente: colunas novas, nulas nas 3.003
vendas já gravadas.

## 9. Riscos

1. **`registrarVenda` continua `anon` e não transacional no servidor.** A
   0.6C.6A não muda isso; muda quem responde por "esta venda veio deste
   orçamento".
2. **`bloquear_venda_duplicada` descarta em silêncio.** Nunca disparou, mas se
   disparar o operador vê "falhou" numa venda que passou. É dívida própria.
3. **`venda_itens` no servidor só emite `console.warn` em erro.** Uma venda pode
   existir no Postgres sem itens, e ninguém é avisado. Não é desta fase, mas é
   da mesma família.
4. **O `UNIQUE` só vale para vendas novas.** As 3.003 existentes ficam sem
   vínculo, e as conversões passadas são irrecuperáveis — não há registro de
   qual venda veio de qual orçamento.
5. **Volume:** 3.003 vendas, 1.871 nos últimos 30 dias (~62/dia). Qualquer coisa
   aplicada a vendas tem 60× mais tráfego que orçamentos.

## 10. Decisão

**NÃO PRONTO PARA IMPLEMENTAR 0.6C.6** como especificada.

A operação única server-side é o desenho certo e **não cabe** enquanto a venda
nascer no SQLite e `registrarVenda` estiver fora de escopo. Implementá-la agora
exigiria migrar vendas por dentro — que é a fase que você decidiu adiar.

O que cabe, e resolve a maior parte do dano, é a **0.6C.6A**: dar existência em
disco ao vínculo orçamento→venda, com `UNIQUE` no banco como autoridade, e
trazer `marcarConvertido` para a mesma disciplina de `salvar` e `cancelar`.

Aguardando decisão. Nada foi alterado.
