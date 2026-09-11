# Fase 0.6C.5 — desenho da ação cruzada online sob demanda

**Data:** 10/09/2026 · **Auditoria e desenho. Nada implementado.**
Decisão de produto recebida: **modelo A + ação cruzada online, pela rota
autenticada.** Cabeçalhos em cache local, itens próprios persistidos, itens
alheios nunca persistidos automaticamente, nenhum download em massa.

---

## 1. O que já existe e serve

| Peça | Serve para esta fase? |
|---|---|
| `autenticarTerminalPdv` | **sim, inteira** — token, terminal do banco, empresa do banco, revogado, inativo, empresa inativa, flag por operação |
| `decidirAcesso` | **sim** — cobre sozinho os itens 11 e 12 da ETAPA J |
| `chamarProtegida` (PDV) | **quase** — faz renovação de token, armadilha de redirecionamento e mapeamento de erro, mas é **POST fixo** |
| `orcamentoComando` | **sim para cancelar/salvar**, com um ajuste para documento sem linha local |
| `payloadOrcamento` / `salvar_orcamento_pdv` | **sim** — a escrita já é atômica e já valida revisão |
| `operacaoProtegida` | **NÃO** — ver §3 |

## 2. ETAPA A — a leitura atômica

### O que foi medido

O embedding do PostgREST resolve o par numa requisição só:

```
GET /rest/v1/orcamentos?select=id,numero,status,revisao,empresa_id,terminal_id,
    subtotal,desconto,total,created_at,updated_at,orcamento_itens(...)&id=eq.<id>

200 · 851 bytes · cabeçalho + itens + revisão, tudo junto
```

Funciona, e é a opção mais barata: zero migration.

### Por que ainda assim recomendo a RPC

A atomicidade do embedding depende de o PostgREST gerar **um** statement com
lateral join. É verdade e é documentado — mas é uma garantia que **não está no
nosso código**, não aparece em nenhum teste nosso, e muda se a camada mudar.
Numa fase cujo objetivo é justamente eliminar a fratura entre cabeçalho e itens,
apoiar a garantia central numa propriedade de terceiro é o tipo de coisa que só
se descobre errada em produção.

A RPC coloca a garantia em código nosso, e ainda traz duas coisas de graça: o
filtro de empresa **dentro** da transação (a rota não pode esquecer), e simetria
com `salvar_orcamento_pdv`.

```sql
ler_orcamento_pdv(
  p_empresa_id   uuid,   -- do TOKEN, nunca do corpo
  p_orcamento_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
```

Devolve, de uma leitura só:

```jsonc
{ "estado": "encontrado" | "nao_encontrado",
  "orcamento_id": "...", "numero": 60, "status": "aberto", "revisao": 3,
  "empresa_id": "...", "terminal_id": "...",
  "cliente_nome": null, "subtotal": 276.30, "desconto": 0, "total": 276.30,
  "validade": "...", "observacao": null, "created_at": "...", "updated_at": "...",
  "itens": [ { "produto_id": "...", "produto_nome": "...", "produto_sku": "...",
               "quantidade": 7, "preco_unitario": 38.90, "desconto": 0, "total": 272.30 } ] }
```

Grants idênticos aos da RPC de escrita: `REVOKE ALL FROM PUBLIC, anon,
authenticated` e `GRANT EXECUTE TO service_role`. **A leitura nunca fica
disponível ao `anon`.**

`estado: 'nao_encontrado'` cobre os dois casos que não podem ser distinguidos
para quem pergunta: o orçamento não existe, ou existe em **outra empresa**. Um
terminal não deve conseguir descobrir que um id existe fora da empresa dele.

## 3. A rota — e por que ela NÃO pode usar `operacaoProtegida`

```
GET /api/pdv/orcamentos/[id]
```

`operacaoProtegida` é o molde das **mutações**. Ele exige chave de idempotência
e grava uma linha em `pdv_operacoes` por chamada. Usar isso numa leitura teria
duas consequências, e a segunda é grave:

1. o livro-razão viraria lixo — uma linha cada vez que um operador abre um
   orçamento alheio;
2. **a idempotência devolveria um snapshot velho para sempre.** É literalmente o
   contrário do que uma leitura de snapshot precisa: a chave repetida
   responderia com a revisão de ontem.

Então: molde novo e menor, `leituraProtegida`, com o que a leitura precisa e
nada do que ela não precisa:

```
autenticarTerminalPdv(req, { exigirFlag: true, operacao: 'orcamentos' })
  → RPC ler_orcamento_pdv(ctx.empresa_id, id)
  → 200 | 404 | 401 | 403 | 409 (rota_desligada)
```

Sem chave, sem ledger, sem replay.

**Rollout:** a rota é gatilhada pela mesma flag `rotas_habilitadas.orcamentos`.
Terminal sem a flag recebe `rota_desligada` e o PDV cai no
`getOrcamentoCloud` legado — com `registrarFallback`, como em todo o resto. Sem
isso, ligar a rota nova **removeria** de terminais não migrados uma capacidade
que eles têm hoje.

## 4. ETAPA B — classificação e offline

A classificação já existe (`isCloudOnly` em `verDetalhes`). O que muda:

| Hoje | Depois |
|---|---|
| `getByIdCloud` → duas consultas `anon` | `chamarProtegida('/api/pdv/orcamentos/<id>', null, {metodo:'GET'})` |
| falha de rede → `null` → "Orçamento não encontrado" | `{motivo:'rede'}` → mensagem explícita de conexão |

O sinal de offline **já existe**: `chamarProtegida` devolve `{ok:false,
motivo:'rede'}` quando o `fetch` estoura. Nada novo precisa ser inventado — só
não pode mais ser confundido com "não existe".

`chamarProtegida` precisa de um parâmetro `metodo` (hoje é POST fixo). É a
alteração mínima: as partes valiosas — renovação de token, `redirect:'manual'`,
mapeamento de motivo — continuam num lugar só.

## 5. ETAPA C — editar orçamento alheio

Aqui há uma tensão real que precisa da sua decisão.

O fluxo de edição local hoje é: `atualizar()` grava no SQLite → `_enfileirarUpdate`
→ fila → `orcamentoComando` envia. A chave de idempotência **nasce em disco antes
da primeira tentativa**, e é isso que faz a operação sobreviver a timeout,
fechamento e reinício.

Um documento alheio não tem linha local com itens. Duas saídas:

| | Como | O que se ganha | O que se perde |
|---|---|---|---|
| **C1** cache só em memória | snapshot na tela, envio direto pela rota | nada toca o disco | **sem retry, sem crash-safety**: num timeout o operador não sabe se gravou |
| **C2** operação na fila, documento não | `sync_queue` recebe uma entrada com o payload completo; `orcamento_itens` **não** é tocado | retry, idempotência e a chave em disco, como no resto | o payload com itens fica em disco **temporariamente**, até confirmar |

**Recomendo C2**, e declaro o incômodo: ele coloca itens alheios em disco por
alguns segundos, dentro do payload da fila. Não é o documento — é a operação. A
fronteira da ETAPA F continua valendo ao pé da letra: `orcamento_itens` não
recebe nada.

C1 seria mais puro e menos seguro. Num negócio onde a rede cai, "não sei se
salvou" é pior que "o payload ficou 4 segundos no disco". Mas a escolha é sua.

Em qualquer das duas, a chave é derivada do snapshot:
`${remote_id}:r${revisao_do_snapshot}:salvar` — mesma regra da 0.6C.

## 6. ETAPA E — cancelar orçamento alheio

A mais simples. `orcamentoComando.executar` já usa `remote_id ?? id` e já manda
`acao:'cancelar'` com `revisao_base`. Falta só um caminho que não exija linha
local: hoje ele começa por `db.orcamentos.getById(id)` e desiste se não achar
(`{tipo:'sem_orcamento'}`).

Ajuste mínimo: aceitar um documento vindo do snapshot em vez do SQLite. Nada de
novo em identidade, idempotência ou conflito.

## 7. ETAPA D — CONVERSÃO: aqui a fase trava

Encontrei o que bloqueia, e não é pequeno.

```js
// pdv.js:1807, depois de registrar a venda
window.pdv.orcamentos.marcarConvertido(window._orcamentoParaConverter).catch(() => {});
```

```js
// main.js:455
ipcMain.handle('orcamentos:marcarConvertido', async (_, id) => {
  db.orcamentos.marcarConvertido(id);
  const orc = db.orcamentos.getById(id);
  if (orc?.remote_id) {
    try { await api.atualizarStatusOrcamento(orc.remote_id, 'convertido'); } catch {}
  }
});
```

Três problemas somados:

1. **É um QUINTO caminho de escrita de orçamento**, e não passa por
   `orcamentoComando`. É exatamente a classe de defeito que derrubou o primeiro
   piloto: quatro caminhos, um migrado. Este ficou de fora porque conversão
   estava cercada.
2. **Escreve pelo legado `anon`**, com a flag ligada, sem `registrarFallback` —
   ou seja, sem rastro. Foi assim que o orçamento nº59 passou despercebido.
3. **`.catch(() => {})` e `catch {}`**: o erro é engolido nas duas camadas. A
   venda é registrada e o orçamento pode continuar aberto, **em silêncio**.

Fazer a ETAPA D como especificada — snapshot, confirmar revisão, validar status,
converter de forma consistente — exige migrar `marcarConvertido` para a rota
autenticada. Isso é mexer na conversão orçamento→venda, que está na lista de
"não tocar" desde a 0.6C, e encosta em `registrarVenda`, que você decidiu adiar.

Não vou fazer isso por conta própria dentro de uma fase cujo escopo declarado é
outro. É decisão sua, e há três caminhos:

| | |
|---|---|
| **D-a** | 0.6C.5 entrega A/B/C/E/F/G/H; a conversão de alheio fica **bloqueada na UI**, como hoje; a migração de `marcarConvertido` vira 0.6C.6 |
| **D-b** | ampliar 0.6C.5 para incluir a migração de `marcarConvertido` — mais arriscado, encosta na venda |
| **D-c** | entregar D pela metade: snapshot + validação de revisão na hora de carregar o carrinho, mas a marcação de convertido segue como está — **não recomendo**: dá aparência de consistência sem a garantia, que é pior que a falta dela |

Recomendo **D-a**.

## 8. ETAPA G — concorrência

Os três casos já são cobertos pelo que existe, sem código novo no servidor:

| Caso | Mecanismo | Resultado |
|---|---|---|
| A lê rev 3, B grava rev 4, A grava rev 3 | `SELECT … FOR UPDATE` + `revisao <> p_revisao_base` na RPC | `conflito_versao` → 409, nada gravado |
| A com tela aberta, B edita, A converte | mesma checagem no momento da gravação | recusa; a UI precisa oferecer recarregar |
| A lê e grava sem concorrência | caminho feliz | uma revisão nova, uma operação |

O que falta é **de cliente**: hoje o conflito marca `sync_status='conflito'` e
some da vista. Para documento alheio, o operador está olhando a tela — precisa
de uma mensagem e de um botão "recarregar", não de um estado silencioso.

## 9. ETAPA H — segurança

Coberto por `autenticarTerminalPdv` + `decidirAcesso`: terminal desconhecido
(401), revogado (403), inativo (403), empresa divergente do token (401), empresa
inativa (403), rota desligada (409). `empresa_id` vem **sempre do banco**.

**A única verificação nova:** o orçamento pedido tem de pertencer à empresa do
terminal. Fica **dentro da RPC**, como parâmetro obrigatório, para que nenhuma
rota futura possa esquecê-la. Id de outra empresa devolve `nao_encontrado`, não
"proibido" — não se confirma a existência de documento alheio.

## 10. ETAPA F — a fronteira do SQLite

Teste **estrutural**, não de comportamento: uma varredura do próprio código
garantindo que `INSERT INTO orcamento_itens` aparece só em `registrar()` e
`atualizar()`. Hoje são exatamente esses dois (medido). O teste transforma uma
propriedade acidental em invariante: se alguém adicionar um terceiro ponto, o
teste quebra e a decisão volta a ser explícita.

## 11. Arquivos afetados (previsão)

**`sistema-vargas`**

| Arquivo | |
|---|---|
| `supabase/migrations/*_ler_orcamento_pdv.sql` | novo — a RPC de leitura |
| `src/lib/pdv/leituraProtegida.ts` | novo — molde de leitura autenticada |
| `src/app/api/pdv/orcamentos/[id]/route.ts` | novo — GET |

**`vargasnexus-pdv`**

| Arquivo | |
|---|---|
| `src/main/terminal.js` | `chamarProtegida` ganha `metodo` |
| `src/main/api.js` | `lerOrcamentoAutenticado`; `getOrcamentoCloud` vira fallback explícito |
| `src/main/orcamentoComando.js` | aceitar documento vindo de snapshot |
| `src/main/main.js` | handler de leitura alheia |
| `src/renderer/pages/orcamentos.js` | offline explícito, recarregar em conflito |
| `src/renderer/lib/acoesOrcamento.js` | ação alheia exige online |
| `tests/…` | fronteira, snapshot, concorrência |

**Nenhum arquivo de vendas, recebimentos, Caixa/Tesouraria, RLS ou grants
globais.**

## 12. Impacto no SQLite

| | |
|---|---|
| `orcamento_itens` | **nenhuma escrita nova** — invariante testada |
| `orcamentos` | nenhuma linha nova por leitura alheia |
| `sync_queue` | uma entrada por operação alheia, se C2 for escolhido |
| schema | **sem migration local** |

## 13. Riscos

1. **A tela vira fonte de verdade por alguns minutos.** Snapshot lido, operador
   demora, servidor muda. O 409 protege o dado; o operador precisa entender o
   que aconteceu, ou vai achar que o sistema perdeu o trabalho dele.
2. **C2 põe itens alheios em disco temporariamente.** Declarado, não escondido.
3. **Uma requisição autenticada por abertura de documento alheio** (~70–225 ms
   medidos). Aceitável; não está em laço de sync.
4. **A UI de conflito não existe.** Hoje conflito é estado silencioso. Para ação
   cruzada isso não serve.
5. **`marcarConvertido` continua legado e silencioso** enquanto D-a valer. É
   dívida conhecida, agora documentada com o trecho exato.
6. **Fallback dobra os caminhos** durante o rollout: terminal com flag usa a rota
   nova, sem flag usa o `anon`. É o mesmo padrão já validado, mas é mais um lugar
   onde dois caminhos convivem.

## 14. Testes necessários

Os 15 da ETAPA J, mais três que a auditoria acrescentou:

16. `operacaoProtegida` **não** é usada na leitura (regressão de snapshot velho);
17. id de outra empresa devolve `nao_encontrado`, e não 403 — sem confirmar existência;
18. terminal sem flag cai no legado **e registra fallback**, sem perder capacidade.

O item 9 da sua lista ("nenhum item alheio persistido") é o teste estrutural da
ETAPA F, e é o mais importante do conjunto: é o único que protege a decisão de
produto contra erosão futura.

---

## Veredito

**NÃO PRONTO PARA IMPLEMENTAR 0.6C.5** — como especificada, por causa de uma
etapa só.

**Pronto e desenhado:** A (RPC + rota + molde de leitura), B (classificação e
offline), C (com a escolha C1/C2 pendente), E (cancelamento alheio), F
(fronteira), G (concorrência), H (segurança).

**Bloqueada:** a **ETAPA D**. A conversão de orçamento alheio exige migrar
`marcarConvertido`, que hoje é um quinto caminho de escrita, pelo `anon`, com o
erro engolido em duas camadas. Isso é mexer na conversão orçamento→venda, cercada
desde a 0.6C, e encosta em `registrarVenda`.

**Preciso de duas decisões suas:**

1. **D-a, D-b ou D-c?** (recomendo D-a: entregar o resto e tratar
   `marcarConvertido` numa fase própria)
2. **C1 ou C2?** (recomendo C2: a operação alheia entra na fila com seu payload,
   o documento não vira local, e a idempotência continua com a chave em disco)

Com essas duas respostas, isto vira PRONTO e eu implemento.

---

## 15. Hardening antes do piloto e dívida aberta

**Feito (0.6C.5):** `GET /api/pdv/orcamentos/[id]` declara
`Cache-Control: private, no-store` em **toda** resposta — sucesso, 404 e recusa.
O cabeçalho fica em `leituraProtegida`, não na rota, pelo mesmo motivo que o
filtro de empresa mora dentro da RPC: uma futura rota de leitura não pode
conseguir esquecer.

**DÍVIDA SEPARADA — padronização de cache nas demais rotas autenticadas do PDV.**

Medido em produção em 10/09/2026:

```
GET  /api/pdv/orcamentos/[id]   public, max-age=0, must-revalidate  → corrigido
POST /api/pdv/orcamentos        public, max-age=0, must-revalidate
POST /api/pdv/faltas            public, max-age=0, must-revalidate
GET  /api/pdv/config            public, max-age=0, must-revalidate
```

É o padrão do framework, não regressão. Nas rotas de escrita é inócuo; em
`/api/pdv/config`, que é GET, merece a mesma revisão que a rota nova recebeu.
Não foi tocado nesta fase de propósito — ampliar o escopo no fim de um gate é
como se perde a capacidade de dizer o que quebrou.

## 16. Cobertura das evidências — o que é medido e o que é herdado

Correção de registro pedida na aprovação, e ela é justa:

| Ponto | Status honesto |
|---|---|
| recusa sem token / token forjado / expirado / `alg:none` | **medido ponta a ponta** na rota real |
| inexistente ≡ outra empresa | **medido**, campo a campo, via RPC |
| leitura não grava `pdv_operacoes` | **medido** (11 → 11) |
| `orcamento_itens` intocado | **medido** (225 → 225) |
| rotas de escrita sem regressão | **medido** (heartbeats 22:09:59 → 22:14:59) |
| **terminal revogado → recusado** | **coberto por componente compartilhado** (`decidirAcesso`), NÃO exercitado no GET |
| **flag desligada → recusado** | **coberto por componente compartilhado**, NÃO exercitado no GET |
| **200 com payload real** | **não medido** — depende do Electron 1.9.8, que é o consumidor real |

Terminal revogado não é o mesmo teste que token inválido, e flag desligada foi
inferida do uso de `decidirAcesso`. Ambos são governados pelo mesmo código que
já protege as rotas de escrita em produção — o que é uma garantia real, mas de
outra natureza. Ficam registrados como herdados, não como medidos.

---

## 17. Critério para o corte do `anon` — o que `pdv_operacoes` passa a misturar

A partir da 1.9.9, abrir um orçamento de outro terminal num PDV **sem** a flag
`orcamentos` registra um `legacy_fallback` com operação `orcamentos.ler`.

Isso engorda `pdv_operacoes`, que é a tabela cujo número autoriza o corte do
`anon`. **Crescimento por `orcamentos.ler` NÃO significa terminal ainda
escrevendo pelo `anon`.**

Qualquer critério futuro de corte precisa separar três coisas:

| Categoria | Como identificar | Significa |
|---|---|---|
| **escrita legada real** | `metodo = 'legacy_fallback'` e operação de escrita (`.salvar`, `.cancelar`, `faltas.registrar`, …) | terminal ainda grava pelo `anon` — **bloqueia o corte** |
| **leitura autenticada** | `metodo = 'terminal_token'`, operação `orcamentos.ler` | não aparece aqui: leitura não usa o ledger (`leituraProtegida`) |
| **fallback de leitura** | `metodo = 'legacy_fallback'`, operação `orcamentos.ler` | terminal sem a flag **lendo** pelo `anon` — não é escrita, **não bloqueia o corte** pelo mesmo motivo |

O `upsert` por `(terminal_id, operacao, idempotency_key)` com chave `ler:<id>`
dedupa aberturas repetidas do mesmo documento, então o volume é limitado pela
quantidade de documentos alheios distintos abertos, não por cliques.

Contar tudo junto superestimaria a dependência do `anon` e adiaria um corte que
os dados já autorizariam.

---

## 18. "Revogado" ≠ "incapaz de operar" — enquanto o `anon` estiver aberto

O Balcão 1 foi revogado em 11/09/2026. Vale fixar o que isso significa hoje, e
o que só significará depois do corte do `anon`.

| | Hoje | Depois do corte do `anon` |
|---|---|---|
| rotas autenticadas | **bloqueadas** — `decidirAcesso` devolve 403 `terminal_revogado` | bloqueadas |
| caminho legado | **continua funcionando** — o `anon` não sabe quem é quem | bloqueado |
| efeito prático | o terminal perde a **identidade**, não o **acesso** | o terminal para de operar |

Revogar hoje resolve o caso "a máquina está fora de uso". Não resolve o caso
"a máquina volta a ser usada": ela continua vendendo pelo `anon`, e agora sem
nenhuma chance de se identificar — ou seja, **menos visível**, não mais contida.

É o mesmo padrão do `PDV-001` duplicado em duas máquinas, que deixou 95 vendas
inatribuíveis.

**Consequência para o corte do `anon`:** a revogação só vira bloqueio efetivo
depois dele. Até lá, os dois conceitos precisam aparecer separados em qualquer
relatório de frota — um terminal revogado que ainda opera pelo legado não é uma
contradição, é o estado esperado.
