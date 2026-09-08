# Fase 0.6C — Desenho do orçamento transacional

**Data:** 08/09/2026 · **Somente arquitetura. Nada implementado.**
**Veredito:** **GO PARA IMPLEMENTAR ORÇAMENTOS** — com duas decisões que mudam
o desenho em relação ao que existe hoje.

---

## 1. Fluxo atual

**Criação:** `db.orcamentos.criar()` gera id local e enfileira `create`. O dreno
chama `sincronizarOrcamento`, que faz `insert orcamentos` (id e `numero` vêm do
servidor), depois `insert orcamento_itens` — cujo erro vira `console.warn`.

**Edição:** a fila faz **duas chamadas HTTP**: `atualizarStatusOrcamento` e
`atualizarOrcamento`. A segunda faz `update` + `delete` de todos os itens +
`insert` dos novos, **sem verificar o erro de nenhum dos dois**, e retorna
`{ok:true}` sempre.

**Um acerto que já existe e o desenho preserva:** a fila guarda um *ponteiro*
(`{orcamento_id}`), não o conteúdo, e `_enfileirarUpdate` não duplica item
pendente. O dreno lê o estado local **atual**. Edições antes de sincronizar já
colapsam sozinhas — não é preciso inventar revisionamento de fila.

## 2. Riscos

| # | Risco | Manifesto? |
|---|---|---|
| D1 | Cabeçalho salvo sem itens, relatado como sucesso | **não** |
| D2 | `DELETE → INSERT` sem verificação, janela com zero itens | **não** |
| D3 | Retry cria segundo orçamento e queima número | **não** |
| D4 | Status e conteúdo em chamadas separadas podem divergir | **não** |
| D5 | **Novo** — conversão de orçamento ainda não sincronizado perde o status | **não** |

**Medido:** 55 orçamentos, 0 sem itens, 0 números duplicados. Todos os cinco são
**latentes**. O desenho existe para que continuem assim, não para conter um
incêndio.

**D5, encontrado ao desenhar:** `marcarConvertido()` marca local e enfileira
`update`. Se o `create` ainda não sincronizou, o dreno cai em
`else if (operacao === 'update' && orc.remote_id)`, a condição é falsa, **nada
acontece e o item é marcado processado**. O `convertido` some para sempre.

## 3. Contrato proposto

Uma intenção, não uma sequência:

```
POST /api/pdv/orcamentos
{
  "idempotency_key": "<id_local>:r<revisao>",
  "orcamento_id":    "<id_local uuid>",
  "revisao":          3,
  "revisao_base":     2,        // em que revisão remota esta edição se baseia
  "cabecalho": { cliente_nome, cliente_telefone, vendedor_nome,
                 forma_pagamento, validade_dias, subtotal, desconto,
                 total, observacao, status },
  "itens": [ { produto_id, produto_nome, produto_sku,
               quantidade, preco_unitario, desconto, total } ]
}
```

Criação e edição são **o mesmo comando**. O servidor decide qual é pelo que
existe: sem linha ⇒ cria; com linha ⇒ substitui. Ter dois verbos foi o que
permitiu, hoje, que status e conteúdo andassem separados.

## 4. Idempotência — e por que a chave não é só o id

O `id` local **é** a base certa: já existe, já está no SQLite antes do primeiro
envio, sobrevive a queda, timeout, fechamento, reinício e replay.

**Mas ele sozinho não serve**, e isso é o ponto que a pergunta 3 expõe: se a
chave fosse só o id, a segunda edição do mesmo orçamento bateria na chave da
primeira e seria devolvida como *replay* — a edição nunca aconteceria.

Por isso: **`<id_local>:r<revisao>`**, com `revisao` sendo um contador local
monotônico incrementado a cada edição.

| Cenário | Chave | Resultado |
|---|---|---|
| envio normal | `abc:r1` | executa, cria |
| envio duplicado | `abc:r1` | replay, **um efeito** |
| timeout depois do commit | `abc:r1` | replay devolve o resultado já gravado |
| retry após reinício | `abc:r1` | a chave estava no SQLite; replay |
| edição reenviada | `abc:r2` | chave nova, executa e substitui |
| **versão antiga chegando depois da nova** | `abc:r2` após `abc:r3` | **rejeitada** — ver §5 |

A chave resolve *repetição*. Ela **não** resolve *ordem*. São problemas
diferentes e precisam de mecanismos diferentes — tratá-los com a mesma peça é
como se perde uma edição sem ninguém notar.

## 5. Revisionamento e concorrência

**Recomendação: optimistic locking por revisão. Rejeição, não last-write-wins.**

LWW perde edição em silêncio, que é exatamente a classe de defeito que estamos
removendo. Não faz sentido consertar D1/D2 e reintroduzir a mesma doença pela
porta da concorrência.

A tabela ganha `revisao INTEGER NOT NULL DEFAULT 0`. O cliente manda
`revisao_base` — a revisão remota sobre a qual editou. O servidor:

```
revisao_base = revisao_atual   → grava, revisao_atual += 1
revisao_base < revisao_atual   → 409 conflito_versao (devolve a versão atual)
sem linha e revisao_base = 0   → cria
```

Isso cobre os quatro cenários pedidos:

- **mesmo orçamento em dois computadores** — o segundo a chegar leva 409 e sabe
  que precisa recarregar;
- **edição offline num terminal e online noutro** — o offline volta com
  `revisao_base` velha e é rejeitado, em vez de sobrescrever calado;
- **duas filas com revisões diferentes** — a mais antiga é rejeitada;
- **conversão durante edição pendente** — cai no mesmo 409.

O contador **local** (`revisao` da chave) e o **remoto** (`revisao_base`) são
coisas distintas de propósito: o local dá unicidade à tentativa, o remoto dá
ordem à edição. Ao puxar um orçamento do servidor, o PDV grava a `revisao`
remota para usar como base na próxima edição.

**Não recomendo** conflito manual nem merge: hoje não há edição colaborativa, e
inventar resolução de conflito para um caso que ocorre raramente adiciona
superfície sem pagar por si.

## 6. Numeração

| Pergunta | Resposta |
|---|---|
| Quando o número nasce? | Só na **criação**, dentro da transação. Update nunca renumera. |
| Retry reutiliza o número? | **Sim** — o replay devolve o resultado anterior sem entrar na transação. |
| Falha transacional consome número? | **Sim.** `nextval` não é revertido por rollback, em nenhum Postgres. |
| Importa fiscalmente? | **Não.** Orçamento não é documento fiscal; o número é referência humana. |
| `nextval` dentro da transação? | Sim — é onde ele tem que estar para o número pertencer à linha. |
| Risco de buracos? | Sim, em toda falha de transação. |
| Aceitar ou evitar? | **Aceitar.** |

Evitar buracos exigiria um contador em tabela com lock, o que **serializa toda
criação de orçamento da empresa** e cria ponto de contenção real — para ganhar
uma propriedade cosmética. Pior: qualquer esquema sem buraco degrada sob
concorrência exatamente quando mais importa. Consistência e segurança primeiro,
como pedido: um buraco na numeração é visível e inofensivo; um número duplicado
ou uma edição perdida, não.

## 7. Transação e RPC

```sql
salvar_orcamento_pdv(
  p_empresa_id   uuid,     -- do TOKEN, nunca do corpo
  p_terminal_id  uuid,
  p_orcamento_id uuid,     -- id local, vira a PK remota
  p_revisao_base integer,
  p_cabecalho    jsonb,
  p_itens        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER              -- ver justificativa abaixo
SET search_path = public
```

**Sequência interna:**

1. `SELECT … FROM orcamentos WHERE id = p_orcamento_id FOR UPDATE` — serializa
   revisões concorrentes do mesmo documento;
2. se existe e `revisao <> p_revisao_base` ⇒ devolve `{estado:'conflito_versao',
   revisao_atual}` sem gravar;
3. valida cabeçalho e itens (ver §10);
4. `INSERT … ON CONFLICT (id) DO UPDATE` no cabeçalho, com `revisao = revisao+1`;
   na inserção, `numero = nextval('orcamentos_numero_seq')`;
5. `DELETE FROM orcamento_itens WHERE orcamento_id = …` seguido de `INSERT`;
6. devolve `{estado, orcamento_id, numero, revisao}`.

**Por que `DELETE + INSERT` aqui é seguro e lá não é.** O defeito atual não é o
par delete/insert — é serem **duas requisições HTTP independentes, com erro
ignorado**. Dentro de uma função PL/pgSQL os dois comandos estão na mesma
transação: qualquer erro reverte tudo, inclusive o delete. Nunca existe um
instante observável com o orçamento vazio. É a mesma escrita com uma garantia
que hoje não existe.

**Por que `SECURITY INVOKER` e não `DEFINER`.** A RPC é chamada **apenas** pela
rota, com a chave de serviço, que já ignora RLS. `DEFINER` não acrescentaria
capacidade nenhuma e acrescentaria risco: uma função `DEFINER` que um dia fosse
concedida por engano a `anon` viraria escalada de privilégio pronta.
`search_path` fixo mesmo assim, porque é barato e fecha injeção por resolução de
nome. **A RPC não é concedida ao `anon` em hipótese alguma** — `REVOKE ALL … FROM
anon, authenticated` explícito na migration.

## 8. Offline

O modelo atual já está certo e o desenho o preserva:

```
orçamento criado offline    → SQLite, fila recebe {orcamento_id}
usuário edita (v2)          → revisao local 2, _enfileirarUpdate NÃO duplica
usuário edita (v3)          → revisao local 3, fila continua com UM item
volta a internet            → dreno lê o estado ATUAL (v3) e envia
```

Versões 1 e 2 nunca são enviadas, e não precisam ser. **Coalescer é o
comportamento que já existe** — porque a fila guarda ponteiro, não payload.

A única mudança necessária: a `idempotency_key` deve ser montada **na hora do
dreno**, a partir da revisão local corrente — não na hora de enfileirar. Montar
antes fixaria a chave numa versão que talvez nunca seja enviada.

Não recomendo manter histórico de revisões no cliente: ninguém consome, e seria
peso permanente por um cenário hipotético.

## 9. Conversão orçamento → venda

**Não alterar agora.** Mapeamento:

| Pergunta | Hoje |
|---|---|
| O que a conversão lê? | O orçamento **local** (carrega o carrinho). Não lê o remoto. |
| Usa cabeçalho + itens remotos? | Não. |
| Altera status? | Sim — `marcarConvertido` grava `convertido` local e enfileira `update`. |
| Converte orçamento não sincronizado? | **Sim**, e é aí que mora D5: o `update` é descartado em silêncio. |
| Risco de duplicar venda? | Não por este caminho — a venda tem sua própria trava. |
| Deve exigir revisão confirmada? | **Sim, quando chegarmos lá.** |

A recomendação para a fase da venda: converter só a partir de um orçamento cuja
revisão esteja confirmada pelo servidor. Isso elimina D5 e dá à venda uma
referência estável. **Fora do escopo desta fase.**

## 10. Resultado do endpoint

Sete estados, sem inventar taxonomia:

| Estado | HTTP | Quando |
|---|---|---|
| `criado` | 200 | primeira gravação, com `numero` |
| `atualizado` | 200 | substituição bem-sucedida, com `revisao` |
| `replay` | 200 | mesma chave, devolve o resultado anterior |
| `conflito_versao` | 409 | `revisao_base` desatualizada; devolve `revisao_atual` |
| `payload_invalido` | 400 | validação falhou, com o campo |
| `nao_autorizado` | 401/403 | token, terminal revogado, empresa divergente, flag |
| `erro_transitorio` | 5xx | o cliente **deve** repetir com a mesma chave |

A distinção 409 × 5xx é a que mais importa para o cliente: **409 significa parar
e recarregar; 5xx significa insistir com a mesma chave.** Um `{ok:false}`
genérico faria o PDV tratar os dois igual, e um deles duplicaria.

**Zero itens:** hoje nada impede. **Proponho recusar na criação** — um orçamento
sem itens é exatamente o estado corrompido que D1 produz, e permiti-lo tornaria
o defeito indistinguível de um documento legítimo.

## 11. Rollback

Operacional, sem release: `rotas_habilitadas.orcamentos = false`. O PDV volta ao
caminho antigo, a fila permanece, nada é apagado. Itens enfileirados para a rota
nova continuam válidos — a chave e a revisão são do evento, não da rota.

## 12. Suíte de testes, antes da implementação

**Transação:** create completo · update completo · falha no item ⇒ rollback
total, zero linhas · falha no cabeçalho ⇒ nada gravado · zero itens recusado.

**Idempotência:** retry idêntico ⇒ um efeito · resposta perdida ⇒ replay com o
mesmo `numero` · restart do Electron ⇒ chave sobrevive · edição offline
coalescida ⇒ só a última revisão sai.

**Ordem e concorrência:** `r2` chegando depois de `r3` ⇒ 409 · dois terminais na
mesma revisão ⇒ um grava, o outro 409 · `FOR UPDATE` serializa.

**Autorização:** empresa errada no corpo ⇒ 403 · terminal de outra empresa ⇒
401 · terminal revogado ⇒ 403 · flag desligada ⇒ 409 `rota_desligada` · flag de
outra operação não libera.

**Numeração:** create atribui · update não renumera · replay devolve o mesmo ·
buraco após rollback é aceito e documentado.

**Conversão:** orçamento com edição pendente ⇒ conflito · não sincronizado ⇒ o
caso D5, documentado como conhecido até a fase da venda.

## 13. O que se reaproveita em `registrarVenda`

**Direto, sem alteração:**

- `operacaoProtegida` — auth, empresa server-side, idempotência, telemetria;
- a chave `id local + revisão` gerada antes do primeiro envio;
- o comando único em vez de CRUDs encadeados;
- a RPC transacional `INVOKER` chamada pela rota com a chave de serviço;
- os sete estados de retorno, com a distinção 409 × 5xx;
- coalescing por ponteiro na fila;
- flag por operação e rollback por flag.

**Específico da venda, que orçamento não ensaia:**

- baixa de estoque com CAS e o depósito correto;
- pagamentos, recebíveis, crédito e carteira;
- NFC-e e a ordem entre gravar e emitir;
- impressão do cupom;
- cancelamento e estorno;
- o gatilho de duplicidade que já existe em `vendas`;
- volume: 1854 vendas/30 d contra 33 orçamentos.

O que orçamento prova é a **forma**. O que sobra para a venda são os **efeitos**
— e são eles que exigem a subfase própria já combinada.

## 14. Recomendação final

# GO PARA IMPLEMENTAR ORÇAMENTOS

Com duas decisões que o distinguem de "o mesmo CRUD autenticado":

1. **a chave é `id + revisão`, e a ordem é resolvida por `revisao_base`** —
   repetição e ordem são problemas diferentes;
2. **rejeição por versão, não last-write-wins** — consertar D1/D2 e reintroduzir
   perda silenciosa pela concorrência não seria progresso.

E uma que aceita um custo de propósito: **buracos na numeração são aceitáveis**,
porque a alternativa serializa a criação de orçamentos da empresa inteira para
comprar uma propriedade cosmética.

**Nada implementado. Nenhuma migration aplicada. Nenhuma RPC criada. Nenhuma
linha do Electron alterada.**
