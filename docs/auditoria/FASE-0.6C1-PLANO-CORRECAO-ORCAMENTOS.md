# Fase 0.6C.1 — Plano de correção do piloto de orçamentos

**Data:** 08/09/2026 · **Plano apenas. Nada implementado.**
**Origem:** o piloto foi NO-GO porque migrei o ramo errado.

---

## 1. Fluxo atual completo

São **três** entradas imediatas, e a fila é só o retry. Eu havia mapeado uma.

| # | Onde | O que chama | Quando roda |
|---|---|---|---|
| A | `main.js:419` `orcamentos:registrar` | `api.sincronizarOrcamento` | **sempre**, em `setImmediate`, ao salvar |
| B | `main.js:457` `orcamentos:atualizar` | `api.atualizarOrcamento` | **sempre**, ao editar |
| C | `main.js:443` `orcamentos:cancelar` | `api.atualizarStatusOrcamento` | ao cancelar |
| D | `sync.js:691` fila | *(migrado por mim)* | **só se A/B falharem** |

No caminho feliz, A resolve e D nunca executa. Migrei D.

### O risco que isso escondia

`sincronizarOrcamento` (A) faz `insert` **sem id**, então o Postgres gera um
`gen_random_uuid()` e ele é gravado como `remote_id`. A rota nova usa o **id
local**. São identidades diferentes para o mesmo documento — se A e D
rodassem, seriam **dois orçamentos, dois números**.

Não aconteceu porque A salvou o `remote_id` antes de D rodar. O caminho
existia e eu não o vi.

## 2. Fluxo corrigido proposto

Uma função só, `salvarOrcamentoComando(orcamentoLocalId)`, chamada por A, B, C
e D. Ela lê o estado local atual e decide sozinha.

```
A/B/C (imediato)  ─┐
                   ├─→ salvarOrcamentoComando(id)
D (fila, retry)   ─┘        │
                            ├─ rota nova ok      → grava revisão, LIMPA a fila
                            ├─ rota desligada    → legado + registrarFallback
                            ├─ sem identidade    → legado + (não há como avisar)
                            └─ erro transitório  → deixa na fila, MESMA chave
```

Criação e edição deixam de ser caminhos distintos: são o mesmo comando, e o
servidor decide pelo que existe. É o que já vale na rota; passa a valer no
cliente também.

## 3. Onde nasce a `idempotency_key`

Ela é **derivada**, não sorteada:

```
chave = `${orcamento_id_efetivo}:r${revisao_base}`
```

Ambas as partes já estão no SQLite antes de qualquer rede:

- `orcamento_id_efetivo` — ver §5;
- `revisao_base` — coluna local, `0` até o servidor confirmar a primeira.

Nada é gerado no momento do envio. É a diferença entre esta chave e o
`uuidv4()` que o legado sorteia a cada tentativa.

## 4. Como ela sobrevive ao retry

`revisao_base` **só é incrementada quando o servidor confirma**. Enquanto não
confirmar, toda tentativa — imediata, retry da fila, depois de reiniciar o
Electron, depois de horas offline — monta a **mesma** chave.

Sequência do caso difícil, que é o que você pediu para provar:

```
1. imediato envia  chave abc:r0   → servidor GRAVA (revisão 1)
2. resposta se perde na volta
3. cliente ainda tem revisao_base = 0   (não confirmou nada)
4. fila drena e envia chave abc:r0      ← A MESMA
5. servidor: chave já processada → replay, devolve o resultado anterior
6. cliente grava revisao_base = 1
```

**Efeito no banco: exatamente um.** Não por o cliente ser cuidadoso, mas por a
chave não poder mudar sem confirmação.

## 5. Como `remote_id` será tratado — e como evitar dois números

Esta é a peça que faltava, e vale para os **55 orçamentos que já existem**.

```
orcamento_id_efetivo = remote_id ?? id_local
```

| Situação | `remote_id` | Envia como | Resultado |
|---|---|---|---|
| Documento novo | nulo | `id_local` | cria com o id local; depois `remote_id = id_local` |
| Nascido no legado | uuid do servidor | `remote_id` | a RPC **encontra** a linha e atualiza |

Sem essa regra, editar um orçamento antigo mandaria o id local, a RPC não
acharia linha, trataria como criação — e nasceria **um segundo documento com
número novo**. É exatamente o cenário 3 que você pediu para eliminar, e ele
atinge todo o histórico, não só os novos.

Depois de um sucesso pela rota nova, `remote_id` passa a ser igual ao id
local. As duas identidades convergem e param de existir separadas.

**Número:** só nasce no `INSERT`, dentro da transação. Update nunca renumera,
replay devolve o número anterior sem entrar na transação.

## 6. Como o fallback será registrado

No mesmo ponto, para os dois desfechos de rollout:

```js
if (r.tipo === 'legado') {
  terminal.registrarFallback('orcamentos.salvar', chave, r.motivo)
  // ...só então o caminho antigo
}
```

Hoje isso existe para `faltas` e **não existe** para orçamentos — foi omissão
minha, e é por isso que o orçamento 59 passou sem deixar rastro. Com o
registro, `legacy_fallback` conta orçamento igual conta falta, e o número que
autoriza o corte do `anon` volta a ser confiável.

`sem_identidade` continua sendo o único caso não contável: um terminal sem
credencial não tem como se identificar para dizer que não se identificou.

## 7. Limpar a fila no sucesso imediato

Sem isto, A grava (revisão 1), a fila ainda tem o item pendente, D roda,
monta `abc:r1`, o servidor aceita e cria a **revisão 2 com o mesmo conteúdo**.
Não é duplicidade de documento, mas é uma revisão fantasma.

Regra: **sucesso imediato marca o item da fila como processado.** A fila volta
a ser o que o comentário original dizia que ela é — retry, não segundo
caminho.

## 8. O que fica preservado

| | Como |
|---|---|
| Número | só no insert, dentro da transação |
| `remote_id` | passa a convergir para o id local após o primeiro sucesso |
| Revisão | autoridade do servidor, cliente só guarda |
| Itens | substituição atômica na RPC |
| Fila offline | ponteiro + coalescing, como já é |
| Conversão em venda | **intocada** — D5 segue aberto e documentado |

## 9. Testes de integração — o que faltou da última vez

Meus 690 testes cobrem validação, idempotência, flag e a RPC. **Nenhum
exercita como o PDV chama.** Foi essa a lacuna que me deixou declarar "pronto
para piloto" sobre um caminho que a operação não usa.

Os novos testam `salvarOrcamentoComando` contra um duplo do transporte e um
duplo do estado local:

| # | Cenário | Prova |
|---|---|---|
| 1 | salvar com rede | uma chamada, revisão 1, fila limpa |
| 2 | editar com rede | mesma identidade, mesmo número, revisão 2 |
| 3 | **imediata falha → fila → retry** | **exatamente um efeito** |
| 4 | **imediata grava, resposta se perde → retry** | **mesma chave, replay, um efeito** |
| 5 | replay explícito da mesma chave | resposta idêntica, sem segundo efeito |
| 6 | rota desligada | legado **+ linha `legacy_fallback`** |
| 7 | reabrir o Electron com item pendente | chave reconstruída igual |
| 8 | **orçamento nascido no legado** | usa `remote_id`, **não cria segundo documento** |
| 9 | revisão velha | 409, sem sobrescrever, sem retry infinito |

O 3, o 4 e o 8 são os que teriam pegado o defeito de hoje.

## 10. O que NÃO muda nesta subfase

RLS, `anon`, vendas, recebimentos, Caixa/Tesouraria, `faltas`, outras flags,
e a conversão orçamento→venda. A flag `orcamentos` fica **desligada** até isto
estar feito e testado.

---

**Aguardando autorização para codificar.**
