# FASE 0.6B — Primeira operação protegida com identidade do terminal

**Data:** 07/09/2026
**Escopo:** provar a cadeia de confiança com UMA operação real, pequena e observável.
**Repositórios:** `sistema-vargas` (web/API) e `vargasnexus-pdv` (Electron).

---

## Pré-condições (item 1) — o que é verdade hoje

Medido, não suposto:

| Pré-condição | Estado |
|---|---|
| `PDV_TOKEN_SECRET` no ambiente | **NÃO VERIFICADO.** O conector da Vercel não expõe variáveis de ambiente, então não consigo nem ler nem gravar. Não existe evidência de que ela exista. |
| Deploy web/API ativo | **NÃO.** `origin/main` está em `963e715`; os commits `38c5b9c`, `5ff18c9` e `04af1cf` seguem locais. O último deploy de produção (`dpl_4rz9C…`, READY) é anterior a tudo isso. |
| Terminal piloto ativável | **NÃO.** Nenhuma linha em `pdv_terminais`; sem deploy não há como ativar. |
| Electron ativa e renova | **NÃO EXERCITADO.** Nenhuma release publicada. |
| Fluxo legado funcionando | **SIM**, e medido: 24 h de edge logs mostram 89 `POST /vendas`, 88 `POST /venda_itens`, 158 `PATCH /produtos`, 156 `PATCH /produto_estoque`, todos com papel `anon`. |

**Consequência, aplicada à risca:** a regra do item 1 diz que sem as pré-condições
não se avança para *migração de escrita*. Então esta fase entrega tudo o que é
construção e verificação estática — helper, rota, idempotência, flag,
telemetria, testes, revisão do JWT, auditoria do login legado, ranking e
desenho da venda — e **não** executa o item 14 (terminal piloto), que fica
explicitamente pendente da sua ação nos passos 1 e 2.

---

## A. Operação escolhida

**`POST /api/pdv/impressao` — publicar a URL do servidor de impressão.**

O terminal que tem a impressora física roda um túnel Cloudflare, que ganha uma
URL pública nova a cada reinício. Ele publica essa URL, e os outros terminais
da empresa a consultam a cada sincronização e se autoconfiguram.

Ela cumpre todos os critérios do item 2 — baixa frequência, não bloqueia venda
(o chamador em `main.js:1047` é `.catch(() => {})`), fácil de conferir, sem
estoque, sem dinheiro, sem duplicidade, rollback trivial. E tem uma quinta
propriedade que nenhuma outra candidata tem.

### Ela já está quebrada em produção

Isto foi descoberto ao escolher a operação, e é o achado principal da fase:

```
anon em pdv_impressao:  REFERENCES, SELECT, TRIGGER, TRUNCATE
                        ↑ sem INSERT, sem UPDATE
```

O `anon` perdeu INSERT/UPDATE nessa tabela em `supabase-fechar-anon-onda2.sql`,
cuja justificativa escrita é, literalmente, que o terminal *"lê config, nunca a
grava"*. Ele grava — `atualizarUrlImpressao()` faz um `upsert`. Então:

- o upsert falha sempre, para todo terminal;
- o erro vira um `console.warn` que ninguém lê;
- o chamador engole com `.catch(() => {})`;
- a linha em produção está **com 10 dias** (`updated_at` = 28/08), enquanto a
  URL de um Quick Tunnel muda a cada reinício;
- 24 h de edge logs mostram **376 GET** em `pdv_impressao` (a leitura, viva) e
  **zero** escrita.

É o mesmo padrão do incidente da baixa de estoque de 30/08: fechar o `anon`
quebra o PDV em silêncio.

**Por que isso torna esta a escolha certa:** não existe regressão a causar,
porque não existe funcionamento a preservar. O pior caso da rota nova é
continuar quebrado — o estado de hoje. O melhor é consertar, pela porta certa,
algo que já devia funcionar.

### E ela conserta um furo de isolamento

No caminho legado, a `empresa_id` do upsert vem de `store.get('auth.usuario')`
— o JSON local editável — e `empresa_id` é a **chave primária** da tabela. Um
terminal podia publicar a própria URL de impressão na linha de outra empresa, e
os terminais dela passariam a mandar cupom para uma impressora de fora. Pela
rota nova a empresa vem do token.

---

## B. Fluxo protegido

```
PDV (Electron, main)
  → terminal.chamarProtegida('/api/pdv/impressao', { print_server_url, idempotency_key })
      Authorization: Bearer <token do terminal>     ← cabeçalho, nunca URL
  → operacaoProtegida()
      1. autenticarTerminalPdv  → assinatura, expiração, alg, claims
      2. banco                  → terminal existe? ativo? revogado? empresa ativa?
      3. flag                   → este terminal foi liberado?
      4. conferirEmpresaDoCorpo → empresa no corpo, se vier, tem que bater
      5. reserva a chave de idempotência (índice único no Postgres)
      6. executa: upsert em pdv_impressao com empresa_id DO TOKEN
      7. grava resposta em pdv_operacoes
  → resposta
```

O passo 5 vem **antes** do 6 de propósito. Reservar depois de executar é não ter
reservado nada: duas chamadas simultâneas teriam ambas passado pela verificação
antes de qualquer uma gravar.

---

## C. Helper de autenticação

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/pdv/decidirAcesso.ts` | **puro.** A decisão: claims + linha do banco → passa ou não. Também `conferirEmpresaDoCorpo` e `tokenDoCabecalho`. |
| `src/lib/pdv/autenticarTerminal.ts` | IO: lê o cabeçalho, verifica o token, carrega terminal e empresa, chama a decisão, avança `ultima_atividade_em`. |
| `src/lib/pdv/operacaoProtegida.ts` | O molde: autenticação + empresa + idempotência + auditoria + forma do erro, uma vez só. |
| `src/lib/pdv/decidirIdempotencia.ts` | **puro.** Chave nova / repetir resposta / reexecutar / em voo. |
| `src/lib/pdv/urlImpressao.ts` | **puro.** Valida a URL publicada. |

O que ele valida, em ordem: assinatura → `alg` → tipo → expiração → claims
obrigatórias → terminal existe → **empresa do token bate com a do banco** →
terminal não revogado → terminal ativo → empresa ativa → flag de rollout.

`iss`/`aud` não são usados. A claim `tipo: 'pdv_terminal'` já cumpre a função de
separar este token de qualquer outro que venha a existir, e acrescentar dois
campos sem uso real só daria a impressão de rigor.

---

## D. Idempotência

Chave gerada pelo cliente, aceita no corpo (`idempotency_key`) ou no cabeçalho
`Idempotency-Key`. A trava é o índice único
`(terminal_id, operacao, idempotency_key)` — vem do banco, não de uma checagem
no código, então não há corrida.

Quatro caminhos: chave nova → executa; sucesso anterior → **devolve a mesma
resposta**, com `repetido: true`; erro anterior → reexecuta; igual em voo →
409.

O quinto caso é o que costuma faltar: uma linha `em_andamento` cujo processo
morreu no meio travaria aquela chave para sempre, e o PDV ficaria preso
repetindo algo que não pode nem executar nem desistir. Passados 60 s sem
conclusão, ela é tratada como abandonada. **Esse número precisa ser revisto
quando `vendas` migrar**, junto com o tempo real da transação.

No PDV, a chave desta operação é `impressao:<sha256(url)>` — republicar a mesma
URL não é operação nova; túnel novo muda a URL e a chave muda sozinha.

---

## E. Feature flag

Coluna `pdv_terminais.usar_rotas_novas`, `false` por padrão, ligada por terminal
em Terminais de PDV (`PATCH /api/pdv/terminais`, com auditoria).

Ligar e desligar **não exige deploy nem migration**. Terminal com a flag
desligada recebe **409 `rota_desligada`** — e não 403 — porque não é falta de
permissão, é rollout; o PDV lê o motivo, volta ao caminho legado e não trata
como incidente. Desligar é o botão de recuo, com efeito imediato.

---

## F. Telemetria

`pdv_operacoes` grava: terminal, empresa, operação, chave, status, erro, versão
do PDV, início e conclusão. As 50 mais recentes aparecem no painel.

A coluna `metodo` aceita **só** `'terminal_token'`, por `CHECK`. Isso é
deliberado e é a correção do defeito da 0.6A: um valor `'legacy_anon'` aqui
registraria zero legado para sempre, porque o caminho legado escreve direto no
PostgREST e nunca passa por esta tabela. O lado legado é contado onde ele de
fato aparece — nos edge logs, por
`request.sb.jwt.authorization.payload.role = 'anon'`.

A tela diz isso em texto, para ninguém ler os números como se fossem o total.

---

## G. Testes

`npm test` → **623 testes, 0 falhas** (eram 575). `tsc --noEmit` limpo,
`eslint` sem erro nos arquivos da fase, `next build` completo com
`/api/pdv/impressao` presente.

| Exigência do item 13 | Onde |
|---|---|
| token válido opera | `acesso-terminal.test.ts` |
| sem token / token inválido / expirado | idem + `terminal-token.test.ts` |
| terminal revogado | idem |
| empresa adulterada (token A + body B = 403) | idem |
| terminal de A não opera em B | idem |
| idempotência: duas vezes executa uma | `idempotencia.test.ts` |
| dois terminais não interferem | idem |
| feature flag desligada | `acesso-terminal.test.ts` |

Mais os que a fase acrescentou por conta própria: `alg: none` rejeitado, header
`RS256` ignorado, claims obrigatórias, rotação de segredo, token não lido de
query string, URL de impressão com esquema perigoso ou credencial embutida, e
uma varredura do repositório provando que nenhum componente cliente importa
`pdv/segredo` ou `supabase/admin`.

**O que os testes não cobrem:** as rotas HTTP e o módulo Electron ponta a
ponta. A lógica que decide está isolada em módulos puros para ser testável sem
Postgres e sem HTTP; a fiação entre eles foi verificada por `tsc`,
`next build` e `node --check`. O primeiro teste real é o item 14.

---

## H. Terminal piloto

**Não executado.** Depende dos passos 1 e 2 abaixo, que são seus. Nenhum dado
artificial foi escrito em produção — as duas únicas mudanças no banco foram
DDL: a migration desta fase e o `REVOKE TRUNCATE` do item I.

---

## I. Falhas encontradas

1. **`pdv_impressao` quebrada para o `anon`** desde a onda 2 de fechamento
   (seção A). Corrigida pela migração, não por devolver o grant.
2. **`anon` ainda podia `TRUNCATE` em `pdv_impressao`.** A onda 2 tirou
   INSERT/UPDATE/DELETE e esqueceu TRUNCATE, que apaga a tabela inteira sem
   passar por DELETE. **Revogado nesta fase.**
3. **JWT da 0.6A: claims obrigatórias não eram validadas.** Um token assinado
   por nós, mas sem `terminal_id` ou `empresa_id`, passava na verificação e o
   chamador sairia consultando o banco por `undefined`. **Corrigido** — falta de
   claim agora é recusa.
4. **JWT da 0.6A: `alg` do header não era checado.** Não era vulnerabilidade — a
   verificação nunca perguntou ao token qual algoritmo usar, ela calcula o
   HMAC-SHA256 e compara, então `alg: none` já morria na assinatura.
   **Acrescentada** a checagem explícita mais dois testes, para que uma troca
   futura por biblioteca que respeite o `alg` do token quebre o teste em vez de
   quebrar a segurança.
5. **Sem plano de rotação do segredo.** **Resolvido** (item 24).
6. **Sem `jti`, logo sem revogação individual de token.** Não corrigido, por
   escolha: revogar já funciona via `secret_hash`, com efeito na renovação, e a
   janela máxima é a validade do token — 12 h. Checar uma lista de revogação a
   cada requisição custaria uma consulta por chamada e não se paga enquanto
   nenhuma venda depende do token. **Revisitar antes de migrar `vendas`.**

---

## J. Ranking das próximas operações

Ordem construída a partir do código real e de 24 h de edge logs (`anon`,
métodos de escrita). A frequência importa porque ela é o tamanho do estrago de
uma migração malfeita.

| Ordem | Operação | Escritas/24 h | Risco | Dependências |
|---|---|---|---|---|
| 1 | `faltas` (registrar/atualizar) | 3 | **baixo** — registro informativo, sem efeito em estoque ou caixa | nenhuma |
| 2 | `clientes` (criar/atualizar/endereço) | 0 no período, existe no código | baixo-médio — duplicidade de cliente já foi incidente (`e9302e7`) | resolução de duplicados |
| 3 | `orcamentos` | 0 no período | baixo-médio — não move estoque nem dinheiro até virar venda | clientes |
| 4 | `marketplace_anuncios` | 1 | baixo, mas fora do PDV; talvez nem valha migrar | fila de marketplace |
| 5 | `recebimentos` + `contas_receber` | 0 no período (23+23 em amostra anterior) | **alto** — é dinheiro, mas sem estoque; a transação é menor que a da venda | clientes, créditos |
| 6 | `creditos_cliente` | 0 no período | alto — dinheiro; acoplado a 5 | 5 |
| 7 | **`vendas` + `venda_itens` + `produto_estoque` + `estoque_movimentacoes`** | 89 + 88 + 156 + 158 | **crítico** — têm que migrar JUNTAS, numa transação só | tudo acima + fila offline |
| 8 | `produtos` (PATCH do sync) | 158 | médio — alto volume, mas é espelho; convergiria sozinho | 7 |

Os quatro do item 7 são um bloco: migrar `vendas` sem `produto_estoque` criaria
exatamente a incoerência que a fase quer evitar.

---

## K. Desenho da venda autenticada (sem implementar)

### O problema de hoje, medido

`registrarVenda()` faz, em sequência e **sem transação**:

```
insert vendas → insert venda_itens → para cada item: _ajustarEstoqueCAS
```

Três ou mais chamadas independentes ao PostgREST. Falhar entre a segunda e a
terceira deixa venda com itens e sem baixa de estoque. Não é hipótese: é o
incidente `457847c`, *"A baixa de estoque falhava calada desde 30/08"*.

### A forma

```
Venda nasce em SQLite, com ID gerado no cliente (UUID v4).
   O ID é do cliente porque ele precisa existir antes de haver rede.
   Ele é também a chave de idempotência natural da venda.
        ↓
sync_queue guarda o evento. A venda está concluída para o operador
neste ponto — a nuvem é assíncrona, sempre.
        ↓
Quando há rede:  POST /api/pdv/vendas
                 Authorization: Bearer <token do terminal>
                 Idempotency-Key: <o mesmo UUID da venda>
        ↓
operacaoProtegida → autentica, resolve empresa, reserva a chave
        ↓
UMA chamada: rpc('registrar_venda_pdv', { ... })
   SECURITY DEFINER, PL/pgSQL, tudo dentro de uma transação:
   venda + itens + baixa de estoque + movimentação, ou nada.
        ↓
resposta gravada em pdv_operacoes; o retry recebe a MESMA resposta
```

### Item 22 — route handler com transação, ou RPC?

**RPC transacional, chamada por um route handler autenticado.** Não é
preferência de estilo, é uma restrição: o cliente Supabase/PostgREST **não tem
transação multi-comando**. Um route handler que fizesse quatro chamadas
PostgREST teria exatamente a mesma janela de incoerência de hoje, só que num
servidor diferente — teria movido o bug, não resolvido.

A divisão que funciona:

- **route handler** — autentica o terminal, resolve a empresa, reserva a chave
  de idempotência, valida a entrada;
- **RPC `SECURITY DEFINER`** — a transação, com `search_path` fixo, recebendo
  `empresa_id` como argumento **vindo do token**, nunca do cliente;
- **grants** — a RPC não é concedida ao `anon`. Só o `service_role`, a partir
  do route handler, a alcança. Sem isso, teríamos criado um caminho novo e
  aberto para escrever venda.

### Resposta perdida

O UUID da venda é a chave de idempotência. Retry devolve o resultado da
primeira execução. É o mesmo mecanismo já implementado e testado nesta fase,
com um número a revisar: os 60 s de `SEGUNDOS_ATE_DESTRAVAR` são folgados para
publicar uma URL e podem ser curtos para uma transação de venda grande.

### O que fica em aberto para a fase da venda

- Vendas na fila **antes** da migração: gravadas com o formato antigo, e é
  preciso decidir se são reenviadas pela rota nova ou drenadas pela antiga.
- Fila com token vencido depois de dias offline: renovar antes de drenar, e
  decidir o que fazer se o terminal tiver sido revogado nesse meio-tempo — a
  venda existe, o terminal não deveria mais operar.
- Ordem entre vendas da mesma fila, quando uma falha e as seguintes não.

---

## L. Login do operador (itens 18 e 19)

### O que a função é hoje

```sql
CREATE FUNCTION autenticar_operador_pdv(p_login text, p_senha_hash text)
  RETURNS TABLE(id, nome, cargo, empresa_id, ..., permissoes, limite_desconto)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT ... FROM usuarios_pdv u
      WHERE lower(u.login) = lower(p_login)
        AND u.senha_hash = p_senha_hash
        AND u.ativo = true; $$
```

`SECURITY DEFINER` com `search_path` fixo — isso está certo. O resto, não.

### Riscos, com medição

1. **SHA-256 sem sal, e o hash É a credencial.** O PDV calcula o hash e o envia;
   a função compara. Quem ler `usuarios_pdv.senha_hash` — ou capturar uma
   requisição — autentica sem saber a senha. Ler a coluna já basta.
2. **Sem sal e sem custo, o hash volta a ser senha.** Medido agora, com uma
   consulta: dos **4 operadores ativos, 1 usa a senha `123456`**. Uma consulta,
   um acerto. Um dicionário pequeno faria o resto.
3. **Sem limite de tentativas.** A RPC é chamada pelo `anon`, sem contagem, sem
   atraso, sem bloqueio. 5 chamadas em 24 h no uso real — o que significa que
   qualquer volume acima disso seria trivialmente detectável, e ninguém está
   olhando.
4. **Comparação não é de tempo constante.** `=` em `text`. Menos grave que os
   anteriores e some junto com eles.
5. **`permissoes`, `empresa_id` e `limite_desconto` são gravados em
   `electron-store`** (`api.js`, `store.set('auth.usuario', …)`) — JSON em texto
   puro, editável. Hoje o renderer decide o que pode fazer lendo dali. Um
   operador que edite o arquivo se dá qualquer permissão e qualquer limite de
   desconto. **Toda operação sensível migrada deve revalidar a permissão no
   servidor; "o renderer disse que pode" não é autorização.**

### Proposta (não implementada)

Em ordem, cada passo entregável sozinho:

1. **Limite de tentativas** — tabela `pdv_login_tentativas` por login e origem,
   com atraso progressivo. É a única mudança que não exige tocar em senha
   nenhuma. Fica para a Etapa B, como decidido: mexer no login de todo operador
   em produção pode travar gente num turno, e a 0.6A/0.6B existem para não
   mudar comportamento no balcão.
2. **Trocar o esquema de hash** — `pgcrypto` com bcrypt, senha em claro dentro
   do TLS, verificação no banco. Migração dupla: coluna `senha_bcrypt` nova,
   preenchida no próximo login bem-sucedido de cada operador, com o caminho
   antigo aceito enquanto houver quem não migrou. Sem flag day.
3. **Forçar troca de senha** dos operadores com senha fraca — começando pelo
   que usa `123456`. Posso identificá-lo se você quiser.
4. **Identidade forte do operador**, depois: um token de operador emitido pelo
   servidor, com as permissões dentro, assinado — o mesmo padrão do terminal. Aí
   `permissoes` no `electron-store` vira cache de exibição, não autorização.

---

## M. GO / NO-GO

### GO para migrar a próxima operação — **CONDICIONAL**

A infraestrutura está pronta e testada, mas a cadeia **ainda não rodou uma vez
em produção**. A condição é o item 14: um terminal piloto ativado, com a flag
ligada, publicando a URL de impressão com sucesso, e a linha aparecendo em
`pdv_operacoes`. Enquanto isso não acontecer, a prova é estática.
Cumprido isso, `faltas` é a próxima, e é GO.

### GO/NO-GO para mexer em venda — **NO-GO**

Sem exceção nesta fase. Antes de venda: a cadeia provada em produção, a RPC
transacional desenhada e testada, a fila offline com replay autenticado, os 60 s
de destravamento revistos, e a questão do `jti` decidida.

### GO/NO-GO para RLS nas tabelas críticas — **NO-GO**

Nada mudou desde a 0.5: `vendas`, `venda_itens`, `produto_estoque`,
`estoque_movimentacoes`, `recebimentos`, `contas_receber` e créditos continuam
sendo escritos pelo `anon` em volume — 89, 88, 156 e 158 chamadas em 24 h.
Ligar RLS hoje derruba o caixa. O `anon` também **não** foi revogado.

### GO/NO-GO para Caixa / Sangria — **NO-GO**

Fase 0 mapeou; nada foi construído, e não é a vez.

---

## Ordem de implantação

1. **Criar `PDV_TOKEN_SECRET`** (Vercel → sistema-vargas → Settings →
   Environment Variables → Production):

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   O painel passa a avisar em vermelho enquanto ela não existir, então dá para
   conferir sem adivinhar.

2. **Deploy do web/API** — `git push`. Traz 0.6A e 0.6B juntas. Aditivo: as
   rotas novas não são chamadas por ninguém, a tela nova depende de permissão, e
   nenhum terminal tem a flag ligada.

3. **Release do Electron** — ainda **não publicada**, aguarda sua autorização.
   Um PDV com esta versão e sem ativação opera igual a hoje.

4. **Ativar o terminal piloto** e conferir no painel: status ativo, última
   autenticação avançando.

5. **Ligar a flag só nele** e reiniciar o servidor de impressão daquele terminal
   para forçar uma URL nova. Conferir: a linha em `pdv_operacoes` com
   `sucesso`, e `pdv_impressao.terminal_id` passando a ser o UUID do terminal em
   vez de `PDV-001`.

6. **Observar** (item 15). Com os dados desta fase dá para responder: quantas
   operações protegidas houve, quantas falharam e por quê, se houve renovação de
   token, se houve fallback, se houve revogação, se houve empresa divergente e
   se houve retry — as sete perguntas saem de `pdv_operacoes` mais os edge logs.

**Rollback:** desligar a flag (efeito imediato, sem deploy) → desvincular o
terminal → reverter o deploy. A migration não precisa ser revertida: tabela nova
e uma coluna com default `false`.

---

### Pendências herdadas, ainda abertas

- Comentários da era 0.5 em `fila.ts`, `precisaEnviar.ts` e `travados/route.ts`
  afirmam causalidade que o banco desmentiu (0 de 9285 divergentes).
- `diagnostico-fila-58267446668.sql` e `supabase-pdv-config-promocao.sql` na
  raiz do repositório.
- `security@sistemavargas.com.br` e `privacidade@sistemavargas.com.br`
  publicados em `/seguranca` e inexistentes.
- `/seguranca` afirma repositório privado; o repositório é público.
- MFA ausente em 7 contas administrativas.
- **Novo:** um operador de PDV com a senha `123456`.
