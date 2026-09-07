# FASE 0.6A — Identidade do terminal e emissão de token

**Data:** 07/09/2026
**Escopo:** Etapa A da arquitetura escolhida na Fase 0.6. Só identidade e token.
**Repositórios tocados:** `sistema-vargas` (web/API) e `vargasnexus-pdv` (Electron).

> Regra que governou a fase: **medido não pode parecer suposto**. Onde este
> relatório afirma que algo funciona, existe teste ou código citado. Onde não
> existe, está dito que não existe.

---

## A. O que esta etapa muda, em uma frase

Antes, o terminal dizia ao banco quem ele era. Agora existe um segundo caminho
em que o servidor diz — e o antigo continua ligado, intacto, ao lado dele.

Concretamente, o que era

```
terminal_id = store.get('config.terminal_id')       → texto num JSON local editável
empresa_id  = store.get('auth.usuario').empresa_id  → idem
credencial  = chave `anon` embutida no instalador   → igual em todos os terminais
```

passa a ter, em paralelo:

```
código de ativação (uso único, 15 min, emitido no painel por usuário autenticado)
  → o terminal gera um segredo de 256 bits e o apresenta uma vez
  → o servidor guarda só o hash
  → token HS256 de 12 h, cuja `empresa_id` é lida da linha do terminal no banco
```

## B. O que esta etapa NÃO faz

Isto é metade do trabalho da fase, e vale listar explicitamente:

- **Não muda nada no caixa.** Nenhuma venda passa pelo código novo. Um terminal
  que atualizar e nunca for ativado opera exatamente como antes.
- **Não ativa RLS antiga**, não revoga o `anon`, não corta o fluxo legado.
- **Não mexe no login do operador** nem na RPC `autenticar_operador_pdv`.
- **Não cria Caixa nem Sangria** (Fase 0, seções separadas).
- **Não publica release do Electron.** O código está commitado, não distribuído.

## C. Modelo de dados

Migration `20260907004700_pdv_identidade_do_terminal.sql`, **já aplicada em
produção** em 07/09 via `apply_migration` sob o nome `pdv_identidade_do_terminal`.
O arquivo foi trazido para `supabase/migrations/` nesta entrega — antes ele
existia só no banco, o que era drift.

| Tabela | Papel |
|---|---|
| `pdv_terminais` | um terminal autorizado: empresa, nome, `secret_hash`, status, revogação, telemetria |
| `pdv_ativacoes` | um código de ativação: `codigo_hash`, `codigo_prefixo`, `expira_em`, `usado_em`, `usado_por_hash`, `tentativas` |

Decisões que não são óbvias:

- **RLS ligada desde o nascimento**, com o padrão da casa
  (`empresa_do_meu_grupo(empresa_id) OR is_system_admin()`, papel `authenticated`).
  Nenhum `using (true)`.
- **`REVOKE ALL ... FROM anon`** nas duas tabelas. A chave que o PDV carrega hoje
  não alcança nem para ler.
- **`REVOKE DELETE, TRUNCATE ... FROM authenticated`**: terminal não se apaga.
  Revogar muda status. O histórico é o que permite responder depois "quem
  autorizou aquele terminal, e quando".
- **SHA-256, não bcrypt**, no `secret_hash`. bcrypt existe para senha humana —
  curta e previsível. O segredo aqui tem 256 bits de aleatoriedade: não há
  espaço de busca para atacar, e bcrypt só custaria CPU a cada renovação.
  A mesma escolha seria **errada** para a senha do operador.

## D. Fluxo de ativação

1. Um usuário com a permissão `gerenciar_terminais_pdv` autoriza um terminal no
   painel. O servidor cria a linha e um código `AB7F-K93X`, mostrado **uma vez**.
2. O operador digita o código no PDV, em Configurações.
3. O PDV **gera o segredo antes de chamar** e o envia junto com o código.
4. O servidor confere, grava o hash do segredo, marca o código usado e devolve
   um token.

O passo 3 é o que torna a ativação repetível. Se o servidor gerasse o segredo e
a resposta se perdesse na volta, o retry encontraria o código já usado e o
terminal ficaria travado — o segredo teria se perdido no caminho e o servidor
só teria o hash. Com o terminal gerando antes, repetir a chamada com o mesmo
segredo é reconhecido como a **mesma** ativação (`usado_por_hash`), e a
resposta é sucesso. Testado em `terminal-ativacao.test.ts`, caso
"RETRY DA MESMA ATIVAÇÃO não duplica".

## E. Onde a empresa é decidida

No servidor, sempre, e a garantia é **estrutural, não disciplinar**:
`decidirToken` **não aceita empresa como parâmetro**. Não existe onde escrever
"me dê token da empresa B" — não é que o pedido seja recusado, é que não há
campo. Um corpo com `empresa_id` é simplesmente ignorado pelas duas rotas.

Há um teste que falha se alguém adicionar esse parâmetro no futuro
(`A EMPRESA NÃO É PARÂMETRO — o cliente não tem onde pedir outra`).

## F. Por que o token é assinado com segredo nosso, e não com o do Supabase

A tentação era assinar com o JWT secret do projeto: o PostgREST aceitaria o
token e o terminal viraria `authenticated` no banco imediatamente. Seria errado
**agora**, por um motivo concreto e medido na Fase 0.5: `authenticated` tem
privilégios que `anon` não tem. Um terminal ativado passaria a **poder mais**
do que hoje, numa etapa cuja regra é não mudar comportamento nenhum.

Então: `PDV_TOKEN_SECRET`, nosso, verificado pelo nosso servidor. Quando a
Etapa B mover as escritas para rotas de servidor, é esse mesmo token que as
autoriza. A decisão de emitir um token que o PostgREST aceite fica para quando
a RLS entrar, com o papel certo.

## G. Correção feita durante a implementação

O contrato inicial tinha o PDV enviando `secret_hash` e o servidor gravando
exatamente esse valor. Isso reproduzia a falha do `senha_hash` legado: **o
valor guardado no banco era o valor que autentica**, então ler a linha bastaria
para se passar pelo terminal.

Corrigido antes de qualquer terminal existir: o PDV envia o segredo em claro
(dentro do TLS) e o servidor grava `hashDoSegredo(secret)`. Um vazamento do
banco não devolve credencial nenhuma. Teste:
`O QUE VAI NO FIO NÃO É O QUE FICA NO BANCO`.

## H. Onde o segredo vive no terminal

**Não** no `electron-store`. O handler `config:getAll` devolve a store inteira
ao renderer — um segredo ali estaria a um DevTools de distância, além de ficar
em texto puro no disco.

Ele vai para `%APPDATA%\pdv-vargas\terminal-identidade.bin`, cifrado com
`safeStorage` (DPAPI no Windows). O token nunca é persistido: vive em memória
no processo principal, e **não existe** um `terminal:token` no preload — expor
o token ao renderer seria devolver a credencial exatamente ao lado que esta
etapa está tirando de circulação.

Se a plataforma não tiver cifragem disponível, a ativação é **recusada** em vez
de gravar a credencial em claro. Isso não bloqueia ninguém: o terminal segue no
modo antigo, que é onde ele já estava.

## I. Telemetria

`versao_pdv`, `dispositivo` (hostname, SO, usuário do SO) e
`terminal_id_legado` são gravados na ativação e na renovação.

São **informativos e forjáveis**, e o servidor sabe disso — não entram em
decisão nenhuma. Existem para o painel poder dizer "este é o do balcão" e para
casar o terminal novo com as vendas antigas na hora de conferir o rollout.

Uma renovação de hora em hora mantém `ultima_autenticacao_em` fresco. Sem ela o
painel não distinguiria "ativado" de "ativado e vivo".

**O painel foi corrigido durante a implementação:** ele tinha um contador
"Ainda no modo legado" lendo `metodo_ultima_auth = 'legacy_anon'` — valor que
**nada no sistema escreve**, porque o caminho antigo não passa por esta tabela.
Ele mostraria zero enquanto todo mundo, sem exceção, ainda vende pelo caminho
antigo. Trocado por contadores do que é de fato medido, mais uma frase explícita
de que todas as vendas ainda saem pelo caminho antigo.

## J. Testes

`npm test` → **575 testes, 0 falhas.** `tsc --noEmit` limpo. `eslint` sem erro
nos arquivos desta fase.

32 testes novos, dos quais os que sustentam a segurança da etapa:

| O que prova | Arquivo |
|---|---|
| token adulterado (trocar a empresa no payload) é rejeitado | `terminal-token.test.ts` |
| token expirado, e no instante exato da expiração, é rejeitado | idem |
| token de outro tipo não passa por token de terminal | idem |
| lixo não derruba o verificador | idem |
| o que vai no fio não é o que fica no banco | idem |
| código expirado / usado / tentativas esgotadas são recusados | `terminal-ativacao.test.ts` |
| retry da mesma ativação devolve sucesso, não erro | idem |
| código inexistente e código errado dão a MESMA mensagem | idem |
| terminal revogado não reativa nem renova | idem |
| terminal sem segredo gravado nunca autentica | idem |
| a empresa não é parâmetro | idem |

**O que os testes NÃO cobrem:** as rotas HTTP em si e o módulo Electron. A
lógica que decide está isolada em módulos puros justamente para ser testável
sem Postgres e sem HTTP, mas a fiação entre eles foi verificada só por leitura
e por `tsc`/`node --check`. O primeiro teste de verdade é a ativação de um
terminal real — ver a ordem no item L.

Não houve escrita artificial em produção para testar ativação, conforme pedido.

## K. Riscos residuais

1. **`PDV_TOKEN_SECRET` ainda não existe.** As rotas de ativação e de token
   lançam erro sem ela — de propósito: um segredo vazio assinaria tokens que
   qualquer um reproduz, e o sistema *pareceria* funcionar. Precisa ser criada
   antes do deploy (item L.1).
2. **A RPC legada `autenticar_operador_pdv` continua sem limite de tentativas.**
   Decisão para o item 26: **fica para a Etapa B**, e a justificativa é a regra
   desta fase. Adicionar contagem de tentativas ali é mexer no caminho de login
   de todo operador em produção, com risco real de travar gente de verdade num
   turno — exatamente o tipo de mudança de comportamento que a Etapa A proibiu.
   O código de ativação novo já nasce com limite (5 tentativas, 15 minutos).
3. **Chave `anon` segue embutida e válida.** É o fluxo legado, que por
   definição não podia ser cortado nesta etapa. Ela é o motivo de a Etapa B
   existir.
4. **O `secret_hash` no banco é lido pela chave de serviço.** Quem tiver a
   `service_role` já podia tudo — isto não piora nada, mas registra-se: a
   `service_role` continua sendo o ponto único de confiança total.
5. **Sem revogação em tempo real.** Um terminal revogado para de renovar, mas o
   token que ele tem em mãos vale até vencer. Janela máxima: 12 horas. Reduzir
   isso custa uma consulta ao banco por requisição, e não vale enquanto nenhuma
   venda depende do token.

## L. Ordem exata de implantação

1. **Criar `PDV_TOKEN_SECRET`** no ambiente do sistema web (Vercel →
   Settings → Environment Variables, Production). Pelo menos 32 caracteres
   aleatórios. Gere com:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Sem ela, o passo 4 falha em voz alta — que é o comportamento desejado, mas
   melhor não descobrir isso no balcão.

2. **Deploy do web/API** (`git push`, a Vercel constrói do `main`). A migration
   já está aplicada; o deploy só traz as rotas e a tela. Nada muda para quem já
   usa o sistema — a tela nova aparece em Configurações → Terminais de PDV, e
   só para quem tem a permissão.

3. **Release do Electron** — `vargasnexus-pdv`, versão nova, pelo canal de
   atualização de sempre. **Ainda não foi publicado** e depende de autorização
   explícita. Um terminal que receber esta versão e nunca for ativado opera
   exatamente como antes.

4. **Ativar UM terminal**, de preferência fora do horário de pico. Autorizar no
   painel, digitar o código no PDV, conferir que o painel mostra "ativo" e a
   última autenticação. Vender uma venda normal e confirmar que ela seguiu o
   caminho de sempre.

5. **Observar por alguns dias.** O que se olha: `ultima_autenticacao_em`
   avançando de hora em hora, e nenhuma mudança em taxa de erro de venda. Só
   depois ativar os demais.

O passo 4 é o primeiro teste real da fiação entre rota, banco e Electron. Se
algo estiver errado, é ali que aparece — e o custo de estar errado é um
terminal que não ativa, não uma venda perdida.

## M. Rollback

Cada passo desfaz sozinho:

- **Passo 3–4:** desvincular o computador em Configurações. O terminal volta ao
  modo antigo imediatamente, sem passar pelo servidor.
- **Passo 2:** reverter o deploy. As tabelas ficam, sem uso; nenhum caminho de
  venda as consulta.
- **A migration não precisa ser revertida** em nenhum cenário: são tabelas
  novas, sem trigger, sem foreign key apontando para elas, e o `anon` não as
  alcança.

Não existe estado intermediário que quebre venda, porque venda nenhuma passa
por aqui.

---

## GO / NO-GO

**GO** para os passos 1 e 2 (variável de ambiente e deploy do web/API).

Justificativa: são aditivos e verificados. As tabelas já existem e ninguém as
consulta; as rotas novas não são chamadas por nada em produção; a tela nova é
visível só para quem tem a permissão; `tsc`, `eslint` e 575 testes passam. O
pior caso de um erro aqui é uma tela administrativa que não funciona.

**GO condicionado** para o passo 3 (release do Electron), com a condição sendo
sua autorização explícita — o item 42 da fase proíbe publicar release
automaticamente, e eu não publiquei.

**NO-GO**, ainda, para qualquer coisa da Etapa B: mover escrita, ativar RLS,
revogar `anon`, tocar no login do operador. Nada disso foi feito, e a condição
para começar está escrita no painel: "Aguardando ativação" chegar a zero.

### Pendências herdadas, ainda abertas

Não pertencem a esta fase, mas continuam de pé e não devem sumir:

- Os commits `38c5b9c` e `5ff18c9` seguem **sem push**.
- Mensagens de commit e comentários da era da Fase 0.5 (`fila.ts`,
  `precisaEnviar.ts`, `travados/route.ts`) afirmam causalidade que o banco
  depois desmentiu — 0 de 9285 divergentes.
- `diagnostico-fila-58267446668.sql` continua na raiz do repositório.
- `supabase-pdv-config-promocao.sql` também está na raiz, fora de
  `supabase/migrations/`.
- `security@sistemavargas.com.br` e `privacidade@sistemavargas.com.br` estão
  publicados em `/seguranca` e **não existem**.
- A página `/seguranca` afirma que o código-fonte é mantido em repositório
  privado; o repositório é público.
- MFA ausente em 7 contas administrativas.
