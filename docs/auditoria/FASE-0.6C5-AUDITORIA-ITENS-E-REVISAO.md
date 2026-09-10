# Fase 0.6C.5 — auditoria de itens + revisão multi-terminal

**Data:** 10/09/2026 · **Auditoria. Nada implementado, nada alterado.**
Nenhuma linha de código, schema, migration, flag, release, RLS ou `anon` foi
tocada. Vendas, recebimentos e Caixa/Tesouraria intocados.

**A pergunta:** o SQLite de cada PDV é cache de trabalho do terminal ou réplica
operacional dos orçamentos da empresa?

---

## 1. Mapa atual — como o terminal usa orçamentos

| Função | De onde vêm os dados | Funciona offline? |
|---|---|---|
| listagem | SQLite **+** cloud, mesclados por `remote_id ?? id` | parcial — só as linhas locais |
| busca | SQLite (`listar`) + filtro em memória sobre o cloud | parcial |
| detalhe de documento **local** | SQLite, cabeçalho + itens | **sim** |
| detalhe de documento **de outro terminal** | `getOrcamentoCloud` — busca sob demanda | **não** |
| edição | SQLite, exige itens locais | sim |
| cancelamento | SQLite + fila | sim |
| conversão em venda | SQLite, exige itens locais | sim |
| impressão | SQLite | sim |

### O achado que decide a fase

**O produto já implementa o modelo A, e o impõe estruturalmente.**

```js
// verDetalhes(id)
let orc = await window.pdv.orcamentos.getById(id);     // local
if (!orc) {
  orc = await window.pdv.orcamentos.getByIdCloud(id);  // sob demanda, online
  isCloudOnly = true;
}
const podeAcionar = !isCloudOnly && !AcoesOrcamento.ehTerminal(orc);
```

E, do lado do banco, `orcamento_itens` local é escrito em **exatamente dois
lugares** — `registrar()` e `atualizar()`, ambos ações do próprio operador.
**Nenhum caminho jamais escreveu item vindo do cloud.**

Portanto, hoje:

| Pergunta | Resposta observada no código |
|---|---|
| operador precisa editar orçamento de outro terminal? | **não pode** — `podeAcionar = false` |
| precisa converter em venda orçamento de outro terminal? | **não pode** — mesma regra |
| precisa ver os itens desse orçamento? | **sim, e já vê** — busca sob demanda, online |
| offline? | **não vê** — cai em "Orçamento não encontrado" |

### O que eu NÃO consigo medir

Se o **negócio** precisa dessa edição cruzada. O dado que responderia isso nunca
foi gravado: `terminal_id` existe em 1 dos 58 orçamentos, e `operador_nome`
registra quem **criou**, nunca quem editou. O que dá para dizer:

```
criados por:  balcao 35 · Eliane 10 · bazareficaz@gmail.com 10 · Fernando 2 · Administrador 1
editados alguma vez: 10 de 58
```

Cinco nomes de operador em máquinas diferentes, então a *possibilidade* de
cruzamento é real. A *prática* é inobservável com o que foi registrado. **Essa é
a única pergunta desta auditoria que não tem resposta medida — e é sua.**

## 2. Dados reais medidos

### Servidor

```
orcamento_itens: id, orcamento_id, produto_id, produto_nome, produto_sku,
                 quantidade, preco_unitario, desconto, total, created_at

225 itens · 58 orçamentos · TODOS com itens · 0 órfãos
por orçamento: média 3,9 · mediana 3 · máximo 28
```

### SQLite local

```sql
CREATE TABLE orcamento_itens (
  id TEXT PRIMARY KEY, orcamento_id TEXT NOT NULL, produto_id TEXT,
  produto_nome TEXT, produto_sku TEXT, quantidade REAL NOT NULL,
  preco_unitario REAL NOT NULL, desconto REAL DEFAULT 0, total REAL NOT NULL,
  FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id) )
```

Sem `created_at`, sem `sync_status`, sem `remote_id` — os itens **não têm
identidade remota**, são conteúdo do documento local. E **nenhum índice em
`orcamento_id`**: o plano de consulta é `SCAN orcamento_itens`. Irrelevante com
4 linhas; não seria com 2.000.

### A diferença que define o problema

```
orçamentos locais ......... 58
   COM itens ..............  3     ← nº1 (Base44), nº59, nº60
   SEM itens .............. 55
itens órfãos ............... 0     (dos dois lados)
```

**55 de 58 cabeçalhos locais existem sem os itens.** E os 3 que têm itens são
exatamente os que este terminal criou. A fronteira já existe, nítida.

*(O nº1 aparece como "local 1 item × remoto 0" porque é o resquício Base44, cujo
cabeçalho não existe mais na tabela `orcamentos` — não é divergência de itens.)*

### Volume

```
histórico: 31/07 → 10/09 (41 dias)
ritmo: 1,40 orçamentos/dia · 5,45 itens/dia

projeção  30 dias:    42 orçamentos,   163 itens
projeção  90 dias:   126 orçamentos,   490 itens
projeção 365 dias:   513 orçamentos, 1.989 itens
```

Volume pequeno. Isso importa para a decisão — mas não do jeito que parece (ver §5).

## 3. Revisão — como funciona hoje

Da RPC `salvar_orcamento_pdv` (0.6C):

1. `SELECT … FOR UPDATE` serializa revisões concorrentes;
2. `revisao <> p_revisao_base` ⇒ `conflito_versao`, **sem gravar** (409);
3. `INSERT … ON CONFLICT (id) DO UPDATE` no cabeçalho, `revisao = revisao + 1`;
4. `DELETE` + `INSERT` dos itens, **na mesma transação**;
5. devolve `{estado, orcamento_id, numero, revisao}`.

| Pergunta | Resposta |
|---|---|
| quando `revisao` incrementa? | em **toda** gravação bem-sucedida pela rota |
| cancelamento incrementa? | **sim** — cancelar passa pela mesma RPC |
| edição legado incrementa? | **não** — `update({status})` direto pelo `anon` |
| a revisão representa o quê? | **cabeçalho + itens**, escritos atomicamente |
| `revisao_base` local incrementa quando? | só em `confirmarSincronizacao`, com o valor que o servidor devolveu |

### A resposta à pergunta central do item 4

> Qual conjunto precisa estar sincronizado antes de ser seguro fazer
> `revisao_base_local = revisao_remota`?

**Cabeçalho e itens da mesma revisão, obtidos atomicamente.** A revisão N não
nomeia o cabeçalho: nomeia o **par**. Adotar a revisão com o cabeçalho de N e os
itens de N−1 faz o terminal declarar que partiu de um estado que ele não tem — e
a próxima edição sobrescreve, em silêncio, itens que ele nunca viu.

E aqui está o obstáculo concreto: **não existe hoje endpoint que devolva o par
atomicamente.** `getOrcamentoCloud` faz duas consultas separadas:

```js
const { data: o } = await supabase.from('orcamentos').select('*').eq('id', remoteId).single();
const { data: itens } = await supabase.from('orcamento_itens').select('*').eq('orcamento_id', remoteId);
```

Uma gravação pode cair entre as duas. Isso é exatamente a fratura que a 0.6C
criou a RPC para eliminar na escrita, reaparecendo na leitura.

## 4. Matriz de estados multi-terminal

Cenário: A e B conhecem X na revisão 3. A edita e grava revisão 4. B estava
offline e volta.

### Sob o modelo A (o de hoje)

| Quem tem os itens de X | Consequência |
|---|---|
| só quem criou X | **o cenário não existe** — B não tem itens, logo B não edita X |

O conflito de itens multi-terminal é **estruturalmente impossível**: exatamente
um terminal detém o documento completo. Não é sorte nem disciplina do operador —
é o único caminho que escreve itens.

### Sob o modelo B (réplica de ativos)

| Situação de B ao voltar | Cabeçalho | Itens | `revisao_base` | Desfecho |
|---|---|---|---|---|
| sem edição local pendente | atualiza | **devem** atualizar | 3 → 4 **só se** o par veio atômico | seguro |
| sem edição pendente, itens não vieram | atualiza | não | **fica 3** | seguro, mas B não pode editar (409 na próxima) |
| com edição local pendente | não atropela | não | fica | **conflito**, como na 0.6C.4 |
| tela aberta antes do down-sync terminar | dado velho na tela | idem | — | **janela real** — B edita a partir do que está na tela |
| A e B editam ao mesmo tempo | — | — | — | um leva 409 e para (já validado na 0.6C) |

A penúltima linha é a que não tem solução barata: o modelo B cria uma janela em
que a tela mostra a revisão 3 enquanto o banco já tem a 4, e o operador decide
olhando a tela. Hoje essa janela não existe, porque quem edita é quem tem.

## 5. Comparação A / B / C — medida, não estimada

Custos de rede medidos contra a base real (mediana de 3 execuções):

| | ms | payload |
|---|---|---|
| descida de cabeçalhos ativos (hoje) | 50 | 30,7 KB |
| tombstones por ids conhecidos (0.6C.4) | 47 | ~0 KB |
| **sob demanda: 1 orçamento (cabeçalho + itens)** | **70** | **0,9 KB** |
| **B: todos os itens dos ativos, num lote** | **61** | **74,5 KB** |
| A: itens só dos 3 documentos próprios | 32 | 1,0 KB |

| Modelo | Por ciclo hoje | Em 365 dias | Por dia (720 ciclos) |
|---|---|---|---|
| **A** cache de trabalho | ~0 KB | ~0 KB | ~0 |
| **B** réplica de ativos | 74,5 KB | ~660 KB | **~475 MB** |
| **C** réplica histórica | 74,5 KB e crescendo sem teto | — | pior que B |

O volume do negócio é pequeno — mas o custo do modelo B não é proporcional ao
volume, e sim ao volume **multiplicado pela frequência do ciclo**. 5,45 itens por
dia viram 475 MB/dia porque cada ciclo rebaixa tudo de novo. Um `updated_at`
incremental reduziria isso; seria mais código, mais estado e mais superfície,
para comprar uma capacidade que o produto hoje não oferece.

| Critério | A | B | C |
|---|---|---|---|
| necessidade operacional comprovada | atende o que existe | atenderia o que não existe | — |
| segurança | nenhuma superfície nova | precisa de leitura autenticada nova | idem, mais dados em repouso |
| consistência | revisão e itens sempre juntos, num dono só | exige leitura atômica que **não existe** | idem |
| offline | falha só para documento alheio | melhor para alheio | idem |
| performance | ~0 | 475 MB/dia sem incremental | insustentável |
| risco | baixo | janela de tela velha, conflito novo | alto |

## 6. Decisão recomendada

**Modelo A — cache de trabalho local/parcial.**

Não por preferência arquitetural, e sim porque:

1. **É o modelo que o produto já implementa**, e o impõe por construção: dois
   pontos de escrita de itens, ambos do próprio operador. Escolher A é formalizar
   o que existe; escolher B é construir capacidade nova.
2. **A consistência de revisão exige leitura atômica do par**, e essa leitura não
   existe. B a exigiria — nova rota autenticada ou RPC — o que é uma fase inteira,
   não um detalhe de B.
3. **B cria um risco que hoje não existe**: a janela entre a tela e o down-sync.
4. O custo de B é 475 MB/dia num negócio de 1,4 orçamentos/dia.
5. A não fecha nenhuma porta: se o negócio *precisar* de edição cruzada, B fica
   disponível como fase própria, com a leitura atômica como pré-requisito
   declarado.

**Condicionante:** se a resposta à pergunta do §1 for "sim, o operador precisa
editar num terminal o orçamento criado em outro", A é insuficiente e a fase muda
de natureza. Essa resposta não está no dado.

## 7. Riscos residuais de adotar A

1. **Documento alheio é invisível offline** — "Orçamento não encontrado", sem
   dizer que é por falta de rede. É o único buraco de UX real que a auditoria
   encontrou.
2. **Os 55 cabeçalhos sem itens ficam permanentemente não-editáveis** neste
   terminal. Sob A isso é correto por desenho, mas precisa estar dito na tela.
3. **`revisao_base = 0` em 57 linhas** enquanto o servidor pode estar adiante.
   Sob A é inofensivo (não se edita o que não é seu); sob B seria uma bomba.
4. **Sem índice em `orcamento_itens.orcamento_id`.** Irrelevante sob A.
5. **A fronteira não está escrita em lugar nenhum** — é consequência de duas
   linhas de código. Se alguém adicionar um terceiro ponto de escrita de itens,
   o modelo muda sem ninguém decidir.

## 8. Desenho da próxima implementação (se A for confirmado)

Sob A, **quase nada precisa ser construído** — e isso é o resultado, não uma
esquiva. O trabalho é tornar a fronteira explícita e fechar o buraco de UX:

| # | O quê | Por quê |
|---|---|---|
| 1 | rótulo na lista distinguindo "documento de outro terminal" do local | hoje o `outro terminal` já existe, mas não diz que os itens são online |
| 2 | mensagem honesta no detalhe offline: "itens indisponíveis sem conexão" em vez de "não encontrado" | é falso dizer que não existe |
| 3 | teste que **fixa a fronteira**: nenhum caminho escreve `orcamento_itens` a partir do cloud | impede a regressão silenciosa do risco 5 |
| 4 | documentar a regra ao lado do código dos itens | a decisão precisa sobreviver à memória |

Explicitamente **fora**: baixar itens em lote, avançar `revisao_base` a partir do
cloud, sincronização incremental, retenção, paginação. Nada disso é necessário
sob A, e cada um deles é reversível de decidir, caro de desfazer.

Se — e só se — a resposta do negócio for "sim, precisa editar cruzado", o desenho
vira outro e começa por: rota autenticada que devolva cabeçalho + itens + revisão
**numa leitura só**; substituição atômica local; `revisao_base` avançando apenas
com o par completo; conflito com operação local pendente reusando o que a 0.6C.4
já estabeleceu; identidade ambígua idem; documento cancelado idem.

## 9. Testes necessários na fase seguinte

Sob A:

1. nenhum caminho escreve `orcamento_itens` a partir de dado do cloud (varredura + teste);
2. documento local mantém itens após ciclos de down-sync;
3. documento alheio não ganha itens locais em nenhum ciclo;
4. offline, o detalhe de documento alheio informa falta de conexão, não inexistência;
5. `revisao_base` de documento alheio nunca avança;
6. regressões 0.6C.2/3/4: número oficial, `UNIQUE`, tombstone, ambiguidade.

Sob B (só se for escolhido): tudo acima mais leitura atômica do par, substituição
de itens sem janela observável, `revisao_base` só com par completo, tela aberta
durante o sync, e conflito com edição local pendente.

---

## Veredito

**NÃO PRONTO PARA IMPLEMENTAR 0.6C.5.**

A auditoria está completa e a recomendação é **modelo A**. O que falta não é
medição: é a única resposta que o dado não contém — **o negócio precisa que um
operador edite, num terminal, um orçamento criado em outro?**

Se a resposta for **não**, a 0.6C.5 é pequena: quatro itens de fronteira e UX, e
nenhuma sincronização de itens.

Se for **sim**, a fase muda de natureza e o pré-requisito é uma leitura
autenticada que devolva cabeçalho + itens + revisão numa transação só — que não
existe.
