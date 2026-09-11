# FASE 0.6C.6A — PILOTO CONTROLADO, ETAPAS 1 E 2

**Veredito: NO-GO — NÃO PUBLICAR 1.10.0.**

O servidor passou. O cliente não. O que barra a publicação é uma regra
explícita da autorização da 0.6C.6A, e ela não é de forma: é de efeito.

> B sincroniza depois:
> — servidor detecta que X já pertence à venda A;
> — **NÃO cria uma segunda venda remota**;
> …

Hoje cria. A seção 9 mostra como, medido.

---

## 1. Deploy (Etapa 1)

`280c7dc` em `origin/main`. Deploy concluído; rota no ar 20 s depois:

```
POST /api/pdv/orcamentos/converter  →  401 {"ok":false,"erro":"Credencial ausente.","motivo":"sem_token"}
```

## 2. Schema em produção — zero backfill

| o que | medido |
|---|---|
| `orcamentos` | 58 linhas |
| `orcamentos.venda_id` preenchidos | **0** |
| `status = 'convertido'` | **0** |
| nº60 (o orçamento real do piloto) | `status=aberto` `revisao=3` `venda_id=null` |

Nenhum vínculo histórico foi inferido. As ~3.003 vendas antigas seguem sem
vínculo, como decidido.

## 3. A RPC não é alcançável por fora

```
converter_orcamento_pdv(p_empresa_id, p_orcamento_id, p_venda_id, p_revisao_base)
  EXECUTE  anon=false   authenticated=false   service_role=true
  SECURITY INVOKER      search_path=public
```

As outras duas da família estão iguais: `ler_orcamento_pdv` e
`salvar_orcamento_pdv`, ambas `anon=false`, `service_role=true`.

`SECURITY INVOKER` é o ponto: mesmo que alguém conseguisse executá-la, ela
roda com o privilégio de quem chamou — e quem chama de fora não tem UPDATE
em `venda_id`. São duas barreiras independentes, não uma repetida.

## 4. `orcamentos.venda_id` não é gravável por fora

O erro anterior era achar que `REVOKE UPDATE (venda_id)` resolvia. Não
resolve: o privilégio de UPDATE na **tabela** continua valendo para toda
coluna, e um REVOKE de coluna não subtrai dele. O que foi aplicado foi
`REVOKE UPDATE ON orcamentos` + GRANT por coluna. Estado hoje:

| coluna | anon | authenticated | service_role |
|---|---|---|---|
| tabela inteira | — | — | UPDATE |
| `venda_id` | — | — | UPDATE |
| `revisao` | — | — | UPDATE |
| `numero` | — | — | UPDATE |
| `status`, `total`, `subtotal`, `desconto`, `cliente_nome`, `observacao`, `validade` | UPDATE | UPDATE | UPDATE |

Medido por HTTP, com a chave `anon`, contra um id **que não existe** —
`ffffffff-…-ffffffffffff`. A sondagem é desenhada para que **nenhum dos dois
desfechos** possa tocar uma linha real: se o privilégio existir, o UPDATE
casa com zero linhas; se não existir, para no privilégio.

```
PATCH {status}                                  204  PERMITIDO
PATCH {status,total,subtotal,desconto,obs,...}   204  PERMITIDO
PATCH {venda_id}                                401  NEGADO  42501
PATCH {status + venda_id}                        401  NEGADO  42501
PATCH {revisao}                                  401  NEGADO  42501
PATCH {numero}                                   401  NEGADO  42501
orçamentos com venda_id depois da sondagem:        0
```

A terceira linha é a que importa: `status` sozinho passa, `status + venda_id`
não. O pedido é recusado **inteiro** — não existe gravação parcial em que a
coluna permitida entra e a proibida é ignorada.

## 5. O contrato da RPC, com rollback (Etapa 2)

Dez cenários numa transação única, encerrada com `RAISE EXCEPTION`. Os
fixtures são cópias da **forma** de uma linha real com `numero` na faixa
900001–900005 e `venda_id` nulo. Nenhuma venda comercial fictícia foi
criada — e nem poderia ser necessária: `orcamentos.venda_id` não tem FK para
`vendas`, então o `venda_id` do teste é um uuid que não existe em lugar
nenhum.

```
 1. id inexistente ................. nao_encontrado
 2. empresa errada ................. nao_encontrado   (vazou numero? nao)
 3. conversao ...................... convertido  rev 0->1  status=convertido  venda=A? t
 4. retry mesma venda (base velha) . ja_convertido  revisao segue 1  (andou de novo? f)
 5. outra venda .................... conflito_conversao  vencedora=A? t  rev=1  venda ainda=A? t
 6. revisao_base defasada .......... conflito_versao  atual=5  escreveu? f
 7. orcamento cancelado ............ recusado_cancelado  status segue cancelado  venda=null
 8. revisao_base NULL .............. convertido  rev 7->8
 9. venda A num 2o orcamento ....... BARRADO 23505 por orcamentos_venda_unica
10. orcamentos REAIS com venda_id .. 0
```

Depois do rollback: 58 orçamentos, 0 vínculos, 0 fixtures vazados, nº60 com
`revisao=3`.

Quatro leituras valem ser ditas em voz alta:

- **Linha 2** — um id que existe em outra empresa responde igual a um id que
  não existe. Confirmar a existência já seria vazá-la.
- **Linha 4** — a idempotência vem **antes** de qualquer validação. O retry
  da mesma venda continua dando sucesso mesmo com `revisao_base` velha, e a
  revisão **não** anda de novo. Se a ordem fosse a inversa, um retry legítimo
  viraria `conflito_versao` e o PDV marcaria a venda como perdida.
- **Linha 5** — o conflito nomeia a vencedora e **não** mexe na revisão. O
  perdedor recebe informação, não um efeito.
- **Linha 9** — `orcamentos_venda_unica` fecha a direção inversa: uma venda
  não pode ser o destino de dois orçamentos.

## 6. O contrato da rota

Medido contra o handler real, sem rede e sem banco — `sem_token` é decidido
antes de `createAdminClient()` e antes de ler o segredo:

```
SEM CREDENCIAL, com corpo completo e plausível  401 sem_token
cabeçalho sem Bearer                            401 sem_token
Bearer forjado                                  401 token_invalido
corpo da recusa                                 {ok, erro, motivo} — e nada do orçamento
idempotency-key do cliente                      401 (não compra acesso)
```

Em produção, o mesmo:

```
POST sem credencial ............... 401 sem_token
POST token lixo ................... 401 token_invalido
POST sem credencial + corpo real .. 401 sem_token
GET (método não existe) ........... 405
GET leitura sem credencial ........ 401 sem_token   cache-control: private, no-store
```

## 7. Terminal revogado e flag desligada: **HERDADO**

Não há como medir isto em produção sem forjar credencial, e forjar exigiria o
segredo de assinatura. Então não se mede — se herda, e o elo fica provado.

A decisão é de `decidirAcesso`, e está testada em
`tests/pdv/orcamentos.test.ts` → "flag por operação", com `operacao:
'orcamentos'`:

- flag ligada passa;
- **flag de faltas não libera orçamentos** (`rota_desligada`, 409);
- `rotas_habilitadas = {}` não libera;
- `status = 'revogado'` não passa (`terminal_revogado`, 403);
- empresa divergente não passa.

Herdar só vale se a rota estiver ligada naquilo, com a **mesma chave**. É o
que `tests/pdv/conversao-rota.test.ts` passa a provar: a rota declara
`flagDaOperacao: 'orcamentos'`, passa por `operacaoProtegida`, não monta
cliente próprio, lê a empresa de `ctx.empresa_id`, deriva a chave depois do
spread do corpo (a do cliente não ganha), transforma erro do Postgres em
exceção (500, repetível) e não mapeia nenhum conflito para 2xx.

Há ainda uma evidência de produção mais forte que o herdado: `pdv_operacoes`
tem **6 `orcamentos.salvar` com sucesso**, o último hoje 11:30 — mesma
cadeia de autenticação, mesma chave de flag, terminal real. O caminho
"terminal válido + flag ligada → autorizado" está exercitado em produção; o
que não está exercitado é esta operação específica. `orcamentos.converter`:
**0 linhas**, como esperado — nenhum PDV roda 1.10.0.

## 8. Flags e testes

| terminal | status | versão | rotas_habilitadas |
|---|---|---|---|
| Escritorio Silvano | ativo | 1.9.9 | `{"orcamentos": true}` |
| Caixa | ativo | 1.9.9 | `{"faltas": true}` |
| Balcão 02 / 03 / 04 | ativo | 1.9.9 | `{}` |
| Balcão 1 | **revogado** | 1.9.0 | `{}` |

Nada mudou. Testes: **755 passando** em `sistema-vargas` (14 novos),
**119** no PDV.

---

## 9. O QUE BARRA A PUBLICAÇÃO

A regra: *"servidor detecta que X já pertence à venda A; **NÃO cria uma
segunda venda remota**"*.

Medido com o `database.js` real, num userData temporário, registrando uma
venda com orçamento:

```
ORDEM QUE A FILA ENTREGA (db.sync.getPendentes):
  1. entidade=venda                operacao=create
  2. entidade=orcamento_converter  operacao=converter
```

A ordem não é acidente de `created_at` — é explícita em `database.js:2035`:

```sql
ORDER BY CASE entidade WHEN 'cliente' THEN 0 WHEN 'venda' THEN 1 ELSE 2 END ASC,
         created_at ASC
```

Então o terminal perdedor **sobe a venda primeiro** e só depois descobre que
perdeu o orçamento. Quando `conflito_conversao` chega, a venda B já está no
Postgres, com os `venda_itens` e as `estoque_movimentacoes` dela.

Três achados independentes, todos medidos:

1. **A ordem da fila.** `venda` (1) antes de `orcamento_converter` (2).
2. **Não há guarda na subida.** `_sincronizarVendaCreate` não consulta
   `sync_status` — `conflito_orcamento? NAO`.
3. **Ela voltaria para a fila de qualquer jeito.** `recuperarVendasSemSync`
   (`sync.js:879`) reenfileira toda venda com
   `remote_id IS NULL AND status != 'cancelada'`, **sem olhar `sync_status`**.
   Corrigir só a ordem não resolveria: no ciclo seguinte a perdedora subiria.

E o servidor não tem como barrar nem perceber:

```
colunas de `vendas` em produção casando com '%orcamento%':  0
```

`vendas.orcamento_id` **não existe no Postgres** — foi aplicado no SQLite e
não no servidor, embora estivesse no escopo autorizado. `montarInsert` manda
`id: venda.id` (a correção de identidade, essa sim está lá) mas não manda
orçamento nenhum, porque não há coluna para receber. Logo não existe
`UNIQUE(orcamento_id)` remoto, e não existe sequer a informação que permitiria
auditar o par depois.

O desfecho real de hoje, então:

| | terminal A (ganha) | terminal B (perde) |
|---|---|---|
| venda local | existe | existe |
| venda remota | existe | **existe também** |
| `venda_itens` remotos | 1× | **2× no total** |
| `estoque_movimentacoes` remotas | 1× | **2× no total** |
| `orcamentos.venda_id` | = A | recusado (correto) |
| marca do conflito | — | só no SQLite de B |

É a mesma forma dos quatro pares duplicados medidos em 30 dias, agora com uma
etiqueta local em cima. O vínculo ficou certo; a duplicidade de estoque que a
fase existe para impedir continua acontecendo.

O que isto **não** é: não é defeito da rota, da RPC, dos grants ou do índice
local. Esses quatro estão provados acima. É a ordem em que o cliente fala com
o servidor, mais uma coluna que faltou do lado do servidor.

## 10. Dívidas registradas, não bloqueantes

- As rotas de **escrita** respondem com `cache-control: public, max-age=0,
  must-revalidate` (o padrão do Next) enquanto a de leitura declara `private,
  no-store`. Vale alinhar — vem de antes da 0.6C.6A, vale para `faltas`,
  `orcamentos` e `heartbeat`.
- `HTTP_POR_ESTADO` e a derivação da chave moram dentro de `route.ts` e por
  isso são testados por leitura de fonte. Em `lib/` (como `payloadOrcamento`)
  seriam testados direto.

## 11. Veredito

**NO-GO — NÃO PUBLICAR 1.10.0.**

Publicar hoje instalaria no Escritório um cliente que converte corretamente
quando está sozinho e duplica venda remota quando não está. Como o Escritório
é o único com a flag, a corrida não aconteceria no piloto — e é exatamente
por isso que publicar seria pior: a fase seria encerrada com a prova mais
importante nunca exercitada.

Itens 1 a 8: GO. Item 9: bloqueia.
