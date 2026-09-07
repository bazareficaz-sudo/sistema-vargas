# Fase 0 — Auditoria do controle de caixa, sangria e tesouraria

**Data:** 06/09/2026
**Escopo:** somente leitura. Nenhuma migration, tabela, coluna, rota, tela ou
correção foi criada nesta fase.
**Fontes:** código em `sistema-vargas/`, banco de produção Supabase
(projeto `ntwfkmwprjciucydedku`, "Sistema Vargas"), consultas apenas `SELECT`
e `information_schema` / catálogo do Postgres.

---

## A. Resumo executivo

**Não existe controle de caixa no Sistema Vargas.** Não é "existe parcialmente"
nem "existe com outro nome": não há tabela, rota, tela, função ou migration
que represente caixa, sessão de caixa, abertura, fechamento, sangria,
suprimento ou fundo de troco.

Evidência:

- Busca no código por `sangria|suprimento|abertura_caixa|fechamento_caixa|fundo_troco|caixa_sessao`
  retorna **dois arquivos**, e nenhum implementa nada:
  - `src/components/usuarios-pdv/permissoes.ts` — declara as chaves
    `abrir_caixa`, `fechar_caixa`, `fazer_sangria`, `lancar_suprimento`,
    `ver_fechamento_caixa`, e o cabeçalho do arquivo diz que elas são
    consumidas pelo **PDV externo** (`vargasnexus-pdv/src/renderer/app.js`);
  - `supabase-cest-tabela.sql` — falso positivo: "sangrias e coquetéis", a
    bebida, na tabela CEST.
- Nenhuma dessas cinco chaves aparece em qualquer outro arquivo do repositório
  (verificado uma a uma). Elas são declaradas e nunca consultadas aqui.
- A listagem completa de tabelas do banco (167 tabelas) **não contém** nenhuma
  com nome relacionado a caixa, sangria, movimentação financeira, lançamento,
  conta bancária, saldo ou extrato financeiro.

### O que já existe e atende

- Registro de **venda** com forma de pagamento, valor, troco, operador,
  vendedor, terminal, empresa e canal (`vendas`).
- **Contas a receber** de carteira/fiado, com parcelas, status e histórico de
  recebimentos (`contas_receber` + `recebimentos`).
- **Contas a pagar** com vencimento, parcela, juros/multa/desconto, tipo de
  despesa e forma de pagamento (`contas_pagar` + `tipos_despesa`).
- **Créditos de cliente** com utilização rastreada (`creditos_cliente` +
  `credito_utilizacoes`).
- Arquitetura de **configuração por empresa** madura e reaproveitável
  (sete tabelas `empresa_config_*`).
- Padrão de **auditoria** existente e funcionando (`empresa_auditoria` via
  `registrarAuditoria`, e `cr_auditoria` para contas a receber).

### O que existe parcialmente

- **Forma de pagamento**: existe como texto livre em três tabelas diferentes,
  com vocabulários que já divergem entre si (detalhe na seção 5 / J).
- **Detalhe de pagamento múltiplo**: a coluna `vendas.pagamentos` (JSONB)
  existe, mas está **nula em ~99% das vendas**.
- **Quem recebeu**: `recebimentos.operador_nome` existe e está **nulo em
  121 de 122 linhas**.
- **Para onde foi o dinheiro recebido**: `recebimentos.conta_destino` existe,
  é enviado no insert, mas **o campo nunca é renderizado na tela** — nulo em
  122 de 122 linhas.

### O que não existe

- Caixa, sessão de caixa, abertura, fechamento, conferência, divergência.
- Sangria e suprimento.
- Fundo de troco.
- Caixa da Empresa (tesouraria).
- Contas bancárias.
- Qualquer ledger, livro-caixa ou razão financeiro.
- Saldo financeiro de qualquer espécie — **nenhuma tabela do sistema guarda
  um saldo de dinheiro**. Os únicos saldos existentes são de cliente
  (`clientes.saldo_devedor`, `clientes.saldo_credito`), que são posição de
  crédito, não dinheiro em espécie.
- Origem dos recursos em contas a pagar (de qual caixa/banco saiu).

### As maiores lacunas

1. **Não existe o conceito de "dinheiro físico".** O sistema sabe que uma
   venda foi *classificada* como dinheiro; não sabe que uma cédula entrou,
   ficou, saiu ou foi contada.
2. **Não existe um ledger.** Toda informação financeira está em tabelas de
   *documento* (venda, conta a pagar, conta a receber), não de *movimento*.
   Somar dinheiro hoje exige varrer três tabelas com regras diferentes.
3. **`recebimentos` é a única tabela que já é quase um movimento de caixa** —
   e é a que está com os campos críticos vazios.

---

## B. Fluxo atual do dinheiro

```
PDV (tela)                        BANCO
──────────────────────────────────────────────────────────────────
venda concluída  ──────────────>  vendas            (documento)
                 ──────────────>  venda_itens
  se carteira    ──gatilho──────>  contas_receber   (documento)
  se fiado       ──────────────>  contas_receber    (documento)
  se devolução>  ──────────────>  creditos_cliente

recebimento de dívida ─────────>  recebimentos      (evento, mais próximo
                                                     de um movimento)
                       ────────>  contas_receber    (atualiza saldo do doc)

pagamento de conta ────────────>  contas_pagar      (UPDATE no documento;
                                                     não gera evento)
```

**Até onde o dinheiro é rastreável:** até a *classificação* da venda.

O sistema responde com precisão:

- quanto foi vendido hoje, e sob qual rótulo de pagamento
  (`vendas.forma_pagamento`);
- quanto foi recebido de dívidas antigas, e em qual forma
  (`recebimentos.forma_pagamento` — os 122 registros têm esse campo
  preenchido);
- quanto está em aberto por cliente (`contas_receber`);
- quais contas foram pagas e quando (`contas_pagar.data_pagamento`).

O sistema **não responde**:

- quanto de dinheiro físico entrou na gaveta;
- quanto ficou como troco;
- quanto saiu por sangria;
- quanto existe no Caixa da Empresa;
- de onde saiu o dinheiro que pagou uma conta;
- qual o saldo esperado de qualquer caixa;
- se houve divergência de contagem.

**O rastro termina no documento. Nunca começa no dinheiro.**

---

## C. PDV

| Item | Estado | Evidência |
|---|---|---|
| Abertura de caixa | ❌ não existe | nenhuma tabela, rota ou tela; `PDVClient.tsx` abre direto na tela de venda |
| Fundo de troco | ❌ não existe | nenhuma coluna em nenhuma tabela |
| Sessão / turno de caixa | ❌ não existe | `vendas` não tem `caixa_id` nem `sessao_id` |
| Operador | ⚠️ parcial | `vendas.operador_nome` TEXT — **nome, não `user_id`**; 9 vendas sem operador |
| Terminal | ⚠️ parcial | `vendas.terminal_id` TEXT existe; **104 vendas sem terminal**, das quais 83 são de carteira |
| Vendas | ✅ existe e atende | `vendas` + `venda_itens`, com empresa, canal, vendedor, itens |
| Pagamentos (forma) | ⚠️ parcial | `vendas.forma_pagamento` TEXT livre |
| Pagamentos (detalhe múltiplo) | ⚠️ existe e não é usado | `vendas.pagamentos` JSONB nulo em ~2.739 de 2.763 vendas |
| Sangria | ❌ não existe | — |
| Suprimento | ❌ não existe | — |
| Fechamento de caixa | ❌ não existe | — |
| Conferência esperado × contado | ❌ não existe | — |
| Divergência | ❌ não existe | — |

**Ressalva sobre o PDV externo:** o cabeçalho de
`src/components/usuarios-pdv/permissoes.ts` afirma que as chaves de caixa são
usadas por `vargasnexus-pdv/src/renderer/app.js`. **Esse repositório não foi
auditado — não tenho acesso a ele.** É possível que o terminal Electron
apresente telas de abertura/sangria. O que se pode afirmar com certeza é que
**não há tabela no banco onde esses eventos pudessem ser gravados**, então,
se essas telas existem, ou não persistem, ou persistem em algum lugar que a
listagem completa de tabelas não revela. **Não confirmado.**

### Persistência de venda com múltiplas formas

O PDV web monta `formas: FormaPag[]` e grava:

```
forma_pagamento = formas.length === 1 ? formas[0].tipo : 'multiplo'
pagamentos      = formas.map(f => ({ forma: f.tipo, valor: f.valor }))
```
(`src/components/pdv/PDVClient.tsx`, função `concluirVenda`)

Mas os dados de produção mostram o rótulo **`misto`** (7 vendas), não
`multiplo` — e essas 7 têm `pagamentos` nulo. Ou seja, **as únicas vendas
multi-forma do banco vieram de outro escritor**, com vocabulário diferente e
sem o detalhe. Ver seção J, risco 2.

---

## D. Contas a receber / carteira / fiado

### Fluxo

1. Venda com `forma_pagamento = 'carteira'` → o gatilho de banco
   **`trg_venda_carteira`** (`AFTER INSERT ON vendas`, função
   `criar_conta_carteira()`) cria a conta a receber. Isso está correto e é
   deliberado: o comentário em `PDVClient.tsx` registra que a regra foi movida
   para o banco porque, na tela, ela alcançava só o PDV web — e o PDV externo
   grava direto no Supabase, o que produziu **87 vendas de carteira,
   R$ 4.498,15, nunca cobradas de ninguém**.
2. Fiado → a tela grava as parcelas diretamente em `contas_receber`
   (`origem = 'fiado'`) e soma em `clientes.saldo_devedor`.
3. Recebimento → `ContasReceberClient.tsx` insere em `recebimentos` e
   atualiza `contas_receber.valor_recebido` / `status`.

**Dado de produção:** 214 linhas em `contas_receber`, **todas com
`origem = 'carteira'`**. Nenhuma com `origem = 'fiado'` — o caminho de fiado
do PDV web nunca foi exercitado em produção, ou as linhas foram criadas pelo
gatilho de qualquer forma. Status: 125 recebido, 68 aberto, 11 vencido,
5 cancelado, 5 parcial.

### A pergunta do enunciado

> Cliente devia R$ 500, pagou hoje R$ 300 em dinheiro. O sistema identifica…

| Pergunta | Resposta | Evidência |
|---|---|---|
| que R$ 300 entraram hoje | ✅ sim | `recebimentos.valor` + `created_at` / `data_recebimento` |
| que foram recebidos em dinheiro | ✅ sim | `recebimentos.forma_pagamento` — 122/122 preenchidos (73 pix, 25 dinheiro, 24 débito) |
| que eram de uma venda anterior | ✅ sim | `recebimentos.conta_id` → `contas_receber.origem_id` → `vendas.id` |
| qual usuário recebeu | ❌ **não** | `recebimentos.operador_nome` **nulo em 121 de 122**; não existe `usuario_id` |
| em qual empresa | ✅ sim | `recebimentos.empresa_id` NOT NULL |
| em qual PDV/caixa | ❌ **não** | não existe coluna de caixa; `conta_destino` (texto livre) **nulo em 122 de 122** |

**A lacuna exata:** `conta_destino` existe no `INSERT`
(`ContasReceberClient.tsx:273`) e no estado do componente
(`ContasReceberClient.tsx:127`), mas **nenhum campo de formulário o
preenche** — não há `<input>`, `<select>` ou `<label>` para ele em
componente nenhum. É um campo morto: sempre `''` → `null`.

---

## E. Contas a pagar

Uma conta vira paga em `src/components/contas-pagar/PagarContasModal.tsx`,
função `confirmar()`, com um `UPDATE` por conta:

```
status: 'pago', data_pagamento, forma_pagamento,
valor_pago, juros, multa, desconto, tipo_despesa_id
```

| Dado | Estado |
|---|---|
| quando foi paga | ✅ `data_pagamento` (DATE — sem hora) |
| forma de pagamento | ✅ `forma_pagamento` TEXT livre |
| valor pago, juros, multa, desconto | ✅ colunas próprias |
| tipo de despesa | ✅ `tipo_despesa_id` → `tipos_despesa` |
| conta bancária | ❌ não existe |
| caixa de origem | ❌ não existe |
| origem dos recursos | ❌ não existe |
| comprovante | ❌ não existe |
| usuário responsável | ❌ não existe |
| histórico do pagamento | ❌ não existe — é `UPDATE` no documento, sem evento |
| `updated_at` | ❌ **a tabela não tem a coluna** |

**Dado de produção:** 149 contas — 76 pagas, 58 pendentes, 14 vencidas,
1 cancelada. Formas: 67 pix, 37 boleto, 3 dinheiro, 42 nulas (todas não
pagas). Nenhuma das 76 pagas registra de onde saiu o dinheiro.

O rateio de juros/multa entre contas pagas juntas é feito por
`src/lib/financeiro/pagamento.ts` (`calcularRateio`) — módulo puro, testado
em `tests/contas/`. É a única lógica financeira do sistema isolada de tela.

---

## F. Financeiro atual — inventário

### Telas
- `src/app/dashboard/financeiro/` — painel; lê **apenas** `contas_receber` e
  `contas_pagar` (`page.tsx:26,30`). Não há nenhuma outra fonte.
- `src/app/dashboard/contas-pagar/`
- `src/app/dashboard/contas-receber/` (+ `extrato/[clienteId]/`)
- `src/app/dashboard/carteira-clientes/`
- `src/app/dashboard/creditos-clientes/`
- `src/app/dashboard/cobranca/`
- `src/app/dashboard/configuracoes/tipos-despesa/`

### Componentes
- `src/components/contas-pagar/PagarContasModal.tsx`
- `src/components/ContasPagarClient.tsx`
- `src/components/contas-receber/ContasReceberClient.tsx`
- `src/components/contas-receber/ReceberEmMassaModal.tsx`

### Bibliotecas
- `src/lib/financeiro/pagamento.ts` — rateio de juros/multa/desconto (puro)
- `src/lib/contas/origemDaConta.ts` — de onde veio a conta a pagar
- `src/lib/contas/resumoFornecedor.ts` — resumo por fornecedor
- `src/lib/contas-receber/extratoPdf.tsx` — extrato do cliente

### Rotas de API
**Nenhuma.** A busca por diretórios de API com `financ|conta|receb|credito|caixa`
retorna vazio. Todo o financeiro escreve no Supabase **direto do navegador**,
via `createClient()` do lado do cliente. Isso é relevante para a Fase 1: hoje
não há uma camada de servidor onde validação, idempotência ou registro de
auditoria financeira pudessem ser impostos.

---

## G. Banco de dados — responsabilidade de cada tabela

| Tabela | Responsabilidade real | Observação |
|---|---|---|
| `vendas` | Documento da venda: totais, forma de pagamento (texto), troco, operador, vendedor, terminal, canal, NFC-e, etapa operacional | 48 colunas; `itens` e `pagamentos` são JSONB redundantes com `venda_itens` |
| `venda_itens` | Itens da venda | **Não tem `empresa_id`** — isolamento depende do join com `vendas` |
| `contas_receber` | Documento a receber, por parcela | `origem`/`origem_id` apontam para a venda; `valor_aberto`, `forma_prevista`, `autorizado_por`, `renegociacao_id` |
| `recebimentos` | **Evento** de recebimento — a estrutura mais próxima de um movimento de caixa que existe hoje | tem `forma_pagamento` e `conta_destino`; **não tem `updated_at`** |
| `contas_pagar` | Documento a pagar | pagamento é `UPDATE` no próprio documento, sem evento; **não tem `updated_at`** |
| `creditos_cliente` | Crédito do cliente gerado por devolução | `valor_original`, `valor_utilizado`, `status` |
| `credito_utilizacoes` | Evento de uso do crédito | tem `venda_id` e `conta_id` — é um mini-ledger de crédito |
| `renegociacoes` | Renegociação de dívida | cabeçalho; parcelas voltam para `contas_receber` |
| `cr_auditoria` | Auditoria específica de contas a receber: `entidade`, `acao`, `dados_antes`, `dados_depois`, `operador` | modelo bom, reaproveitável |
| `empresa_auditoria` | Auditoria geral: `usuario_id`, `usuario_nome`, `acao`, `tabela`, `campo`, `valor_anterior`, `valor_novo`, `ip` | escrita por `registrarAuditoria` em `src/lib/auth/permissoes.ts` |
| `tipos_despesa` | Categorias de despesa por empresa | |
| `empresa_config_financeira` | Config financeira da empresa | só 10 colunas: liga/desliga contas a pagar/receber, contas compartilhadas, plano de contas próprio, chave PIX |
| `estoque_movimentacoes` | **Ledger de estoque** — append-only, com `estoque_anterior`/`estoque_novo`, motivo, referência, usuário | **é o modelo a copiar para o financeiro** |

### Não existe
`caixas`, `caixa_sessoes`, `caixa_movimentos`, `sangrias`, `suprimentos`,
`fechamentos_caixa`, `movimentacoes_financeiras`, `lancamentos`,
`contas_bancarias`, `bancos`, `transferencias_financeiras`, `saldos`.

---

## H. Parâmetros e configurações

O sistema já tem uma arquitetura clara e reaproveitável: **uma tabela por
domínio, chaveada por `empresa_id` UNIQUE**.

- `empresa_config_estoque`, `empresa_config_financeira`,
  `empresa_config_fiscal`, `empresa_config_comercial`,
  `empresa_config_anuncio`, `empresa_config_impressao`,
  `empresa_config_pdv` *(criada em 05/09/2026)*
- Fora do padrão, mas equivalentes: `config_desconto`, `config_fiscal`,
  `config_termometro`, `precificacao_config`, `reposicao_config`,
  `saude_config`, `loja_config`, `nfe_config`, `marketplace_fila_config`,
  `ia_empresa_config`, `deposito_enderecamento_config`.

**Onde os parâmetros de caixa deveriam viver:** em `empresa_config_pdv`
(que já existe e já é do domínio do balcão) para o que é do PDV — fundo
padrão, exigir fechamento, permitir divergência, limite para justificativa.
E numa nova `empresa_config_caixa`, ou em `empresa_config_financeira`, para
o que é de tesouraria — modo simplificado/completo, destino padrão de
sangria.

**Nenhuma configuração hoje é por usuário ou por terminal.** Todas são por
empresa. Se o fundo de troco precisar variar por terminal, isso é estrutura
nova.

---

## I. Multiempresa e segurança

### Hierarquia
`tenants` → `grupos_empresariais` → `empresas` (com `tenant_id` e `grupo_id`).
Usuário: `profiles` (`empresa_id`, `tenant_id`, `grupo_id`, `role`) e
`usuario_empresas` (vínculo N:N, com `empresa_padrao`).
`empresa_parcerias` liga duas empresas do mesmo tenant.

### Vinculação de empresa nas tabelas financeiras
Todas as tabelas financeiras têm `empresa_id`, e o dado está limpo:
- `vendas`: **0 de 2.763 sem `empresa_id`**
- `contas_pagar`: 0 de 149 sem `empresa_id`
- `recebimentos`: `empresa_id` é NOT NULL

Exceção: **`venda_itens` não tem `empresa_id`**.

### RLS — o achado mais grave desta auditoria

| Tabela | RLS | Políticas |
|---|---|---|
| `vendas` | ❌ **desligada** | 0 |
| `venda_itens` | ❌ desligada | 0 |
| `contas_receber` | ❌ **desligada** | 0 |
| `recebimentos` | ❌ **desligada** | 0 |
| `creditos_cliente` | ❌ desligada | 0 |
| `credito_utilizacoes` | ❌ desligada | 0 |
| `renegociacoes` | ❌ desligada | 0 |
| `cr_auditoria` | ❌ desligada | 0 |
| `clientes` | ❌ desligada | 0 |
| `contas_pagar` | ✅ ligada | 1 |
| `empresa_auditoria` | ✅ ligada | 1 |
| `empresas` | ✅ ligada | 1 |

### Privilégios do papel `anon`

| Tabela | `anon` pode |
|---|---|
| `contas_pagar` | SELECT, INSERT, **UPDATE, DELETE, TRUNCATE** |
| `recebimentos` | SELECT, INSERT, **UPDATE, DELETE, TRUNCATE** |
| `creditos_cliente` | SELECT, INSERT, **UPDATE, DELETE, TRUNCATE** |
| `contas_receber` | SELECT, INSERT, **UPDATE, TRUNCATE** |
| `clientes` | SELECT, INSERT, **UPDATE, TRUNCATE** |
| `vendas` | SELECT, INSERT, **TRUNCATE** |
| `venda_itens` | SELECT, INSERT, **TRUNCATE** |

Com RLS desligada e essas concessões, **a chave anônima pública consegue
alterar ou apagar o financeiro inteiro**. Isso contradiz frontalmente o que a
política de segurança pública em `/seguranca` afirma:

> "Row Level Security é imposta no banco nas tabelas de credenciais,
> integrações, histórico de pedidos e registros de auditoria."

`vendas` é histórico de pedido e está sem RLS; `cr_auditoria` é registro de
auditoria e está sem RLS. **A afirmação publicada não corresponde ao estado
medido hoje.**

### Permissões de aplicação
`src/lib/auth/permissoes.ts` define 6 papéis e 19 códigos, com matriz fixa em
`PERMISSOES_POR_PAPEL` e verificação de servidor por `exigirPermissao`.
Os códigos financeiros existentes: `gerenciar_financeiro`,
`ver_dashboard_financeiro`, `editar_credito_cliente`, `cancelar_venda`,
`ver_totais_vendas`, `ver_dados_grupo`.

Um futuro caixa precisaria de códigos novos — `abrir_caixa`, `fechar_caixa`,
`fazer_sangria`, `receber_sangria`, `lancar_despesa_caixa`,
`estornar_movimento`, `ver_saldo_caixa`, `retirada_socio` — e eles se
encaixam sem atrito: basta acrescentar ao union `PermissaoCodigo`, ao
`GRUPOS_PERMISSAO` e à matriz. **Mas há um porém**: o financeiro atual não
passa por rota de servidor nenhuma, então `exigirPermissao` não tem onde
rodar. Ver seção K.

---

## J. Problemas encontrados

1. **RLS desligada em 9 das 12 tabelas financeiras**, com `anon` mantendo
   escrita e TRUNCATE em várias. *(medido)*
2. **Duas grafias para pagamento múltiplo.** O PDV web escreve `'multiplo'`;
   o banco só tem `'misto'` (7 vendas). Escritores diferentes, vocabulário
   divergente, sem constraint. *(medido)*
3. **`vendas.pagamentos` nulo em ~2.739 de 2.763 vendas.** O detalhe do
   pagamento múltiplo existe como coluna e não existe como dado.
4. **Forma de pagamento é texto livre em três tabelas** (`vendas`,
   `recebimentos`, `contas_pagar`), sem CHECK, sem enum, sem tabela de
   domínio. Valores observados: `dinheiro, debito, credito, pix, carteira,
   devolucao, misto, marketplace` em `vendas`; `pix, dinheiro, debito` em
   `recebimentos`; `pix, boleto, dinheiro` em `contas_pagar`. Não há
   `boleto` em vendas nem `carteira` em contas a pagar — os três conjuntos
   nunca foram unificados.
5. **`recebimentos.conta_destino` é campo morto** — no insert, nunca na tela.
   122 de 122 nulos.
6. **`recebimentos.operador_nome` nulo em 121 de 122.** Não se sabe quem
   recebeu.
7. **Nenhuma tabela financeira tem `created_by`/`updated_by`.** Só
   `vendedores` tem. Responsável é sempre texto (`operador_nome`,
   `operador`), quando existe.
8. **`contas_pagar`, `recebimentos`, `cr_auditoria`, `renegociacoes` e
   `credito_utilizacoes` não têm `updated_at`.**
9. **Pagamento de conta a pagar é `UPDATE` destrutivo**, sem evento. Pagar,
   despagar e repagar não deixa rastro; o valor anterior some.
10. **Todo o financeiro escreve direto do navegador.** Não há uma única rota
    de API financeira. Sem camada de servidor, não há como impor
    idempotência, permissão ou auditoria obrigatória.
11. **`venda_itens` sem `empresa_id`.**
12. **104 vendas sem `terminal_id`**, 83 delas de carteira; 9 vendas sem
    `operador_nome`.
13. **`vendas.itens` (JSONB) coexiste com `venda_itens` (tabela).** Duas
    representações do mesmo fato, com risco de divergirem.
14. **A política de segurança publicada afirma RLS onde não há.** Risco
    jurídico e de reputação, além do técnico.

---

## K. Riscos de implementação — o que **não** fazer na Fase 1

1. **Não criar uma segunda fonte de verdade para o que já existe.** Não
   duplicar venda, conta a receber ou conta a pagar dentro do caixa. O caixa
   deve *referenciar* esses documentos, não copiá-los.
2. **Não escrever o caixa direto do navegador.** É o erro que o financeiro
   atual já tem. Movimento de caixa precisa nascer numa rota de servidor, com
   `exigirPermissao`, auditoria e idempotência.
3. **Não tornar sangria uma despesa.** É transferência entre dois lugares que
   pertencem à mesma empresa. Se virar despesa, o resultado do mês fica
   errado — e essa confusão é difícil de desfazer depois que há dado.
4. **Não misturar "venda do dia" com "entrou dinheiro hoje".** São perguntas
   diferentes (seção 18 do enunciado) e precisam de campos diferentes desde o
   primeiro dia.
5. **Não permitir `UPDATE`/`DELETE` em movimento de caixa.** Correção é
   estorno — um novo movimento de sinal contrário, referenciando o original.
   O `estoque_movimentacoes` já faz exatamente isso e é o modelo pronto.
6. **Não começar pelo modo completo.** Gerar movimento por venda multiplica
   o volume por ~2.700 sem que ninguém tenha pedido, e o piloto é um comércio
   com um balcão.
7. **Não retroagir.** As 2.763 vendas existentes não têm caixa. Qualquer
   tentativa de inventar um saldo inicial a partir delas será ficção. O saldo
   do Caixa da Empresa deve começar de uma contagem declarada por alguém.
8. **Não ligar o caixa antes de fechar a RLS.** Criar tabela de dinheiro com
   `anon` podendo escrever seria acrescentar risco ao risco que já existe.

---

## L. Possibilidades de reaproveitamento

| Estrutura existente | Como reaproveitar |
|---|---|
| **`estoque_movimentacoes`** | É um ledger append-only funcionando, com anterior/novo, motivo, referência polimórfica (`referencia_tipo`/`referencia_id`) e usuário. **O ledger financeiro deve ser irmão deste, não um projeto novo.** |
| **`recebimentos`** | Já é quase um movimento de caixa: valor, forma, data, operador, referência ao documento. Ganhando `caixa_id` e `usuario_id`, vira a primeira fonte real de entrada. |
| **`credito_utilizacoes`** | Modelo de evento de consumo já implementado — mesma forma de um movimento. |
| **`empresa_config_*`** | Padrão de configuração por empresa, pronto para os parâmetros de caixa. `empresa_config_pdv` já existe. |
| **`empresa_auditoria` + `registrarAuditoria`** | Auditoria já pronta e usada nas rotas de venda; basta chamar nas rotas de caixa. |
| **`cr_auditoria`** | Modelo de antes/depois em JSONB, se for preciso auditar movimento em detalhe. |
| **`exigirPermissao` / matriz de papéis** | Estrutura de permissão madura; caixa entra como códigos novos. |
| **`src/lib/financeiro/pagamento.ts`** | Precedente de lógica financeira pura e testada, fora da tela. É o padrão a seguir. |
| **`tipos_despesa`** | Categorias já existem; servem para classificar saída de caixa. |
| **`vendas.terminal_id`** | Já identifica o terminal; é o gancho natural para amarrar uma sessão de caixa. |

---

## M. Lacunas — o que precisará ser criado

**Estrutura de dados**
1. Caixa (entidade): PDV/balcão e Caixa da Empresa como tipos do mesmo conceito.
2. Sessão de caixa: abertura, fundo, operador, terminal, fechamento.
3. Movimento de caixa (ledger append-only): entrada, saída, transferência.
4. Fechamento: esperado, contado, divergência, justificativa.
5. Tabela de domínio de formas de pagamento (para acabar com o texto livre).
6. Vínculo de origem em `contas_pagar` (de qual caixa saiu).
7. `caixa_id` e `usuario_id` em `recebimentos`.
8. Contas bancárias (para a fase de conciliação).

**Aplicação**
9. Rotas de API para todo evento de caixa.
10. Telas: abertura, sangria, suprimento, fechamento, Caixa da Empresa, extrato.
11. Códigos de permissão de caixa.
12. Parâmetros por empresa (modo, fundo, destino de sangria, regras de fechamento).

**Segurança (pré-requisito, não item da fase)**
13. Ligar RLS nas tabelas financeiras e revogar escrita do `anon`.

---

## N. Arquitetura recomendada para a Fase 1 — proposta

> Proposta conceitual. Nada implementado.

### Princípio

Separar **documento** de **movimento**, e nunca guardar saldo como coluna.

- *Documento* = o fato comercial (venda, conta a pagar, conta a receber).
  Já existe e não deve ser tocado.
- *Movimento* = o fato monetário (dinheiro entrou, saiu, mudou de lugar).
  Não existe e é o que a Fase 1 cria.
- *Saldo* = soma dos movimentos. **Calculado, nunca gravado.** Saldo em
  coluna é a origem clássica de divergência que ninguém consegue explicar —
  e este sistema já tem um caso documentado desse tipo em
  `produto_estoque` × `produtos.estoque`.

### Entidades

```
caixa                    quem guarda dinheiro
  tipo: pdv | tesouraria | banco (futuro)
  empresa_id             NUNCA cruza CNPJ
  terminal_id            só para tipo=pdv

caixa_sessao             o turno de um caixa pdv
  caixa_id, aberto_por, aberto_em, fundo_inicial
  fechado_por, fechado_em, valor_contado, divergencia, justificativa

caixa_movimento          O LEDGER — append-only
  caixa_id, sessao_id (nulo na tesouraria)
  tipo: entrada | saida | transferencia
  natureza: venda | recebimento | sangria | suprimento | despesa |
            pagamento_conta | aporte | retirada_socio | deposito_banco | ajuste
  forma_pagamento
  valor (sempre positivo; o sinal está no tipo)
  referencia_tipo / referencia_id    → venda, conta_pagar, conta_receber…
  contraparte_caixa_id               → o outro lado da transferência
  estorno_de_id                      → correção é movimento novo
  empresa_id, usuario_id, created_at
```

### A sangria, no modelo

Uma transferência é **dois movimentos com a mesma referência**, nunca um:

```
caixa_movimento  saida       caixa=PDV         natureza=sangria   R$ 2.000
caixa_movimento  entrada     caixa=Tesouraria  natureza=sangria   R$ 2.000
                 contraparte_caixa_id aponta um para o outro
```

Assim o saldo de cada caixa fecha sozinho e nenhum dos dois lados vira
receita ou despesa. É a distinção que a seção 17 do enunciado exige.

### O fechamento do PDV

```
esperado = fundo_inicial
         + Σ movimentos de entrada em dinheiro da sessão
         − Σ movimentos de saída em dinheiro da sessão
contado  = informado por quem fecha
divergência = contado − esperado
```

Ao fechar, o operador decide quanto fica como fundo da próxima sessão e
quanto vai para a tesouraria — o que gera a transferência acima.

### Modo simplificado × completo

O modo vira **um parâmetro que decide se a venda gera movimento**:

- **Simplificado** (recomendado, e o padrão): venda **não** gera movimento.
  O esperado do fechamento é calculado a partir de `vendas` +
  `recebimentos` no período da sessão. Sangria, suprimento, fundo e
  fechamento geram movimento. Volume baixo, conferência diária.
- **Completo**: cada venda em dinheiro gera um movimento de entrada.
  Mesmo ledger, mesma estrutura — só muda quem escreve nele.

A arquitetura acima suporta os dois **sem mudança de schema**, porque o
movimento já nasce com `referencia_tipo`/`referencia_id`. É essa a resposta à
seção 3 do enunciado.

### Futuro que a estrutura já acomoda

Bancos (`caixa.tipo='banco'`), múltiplos caixas (é só mais uma linha),
conciliação (comparar movimentos com extrato importado), cartões e PIX
(movimento com `forma_pagamento` e data de liquidação diferente da venda),
marketplaces (repasse como entrada com referência ao pedido), fluxo de caixa
(projeção = movimentos realizados + `contas_pagar`/`contas_receber` em aberto).

---

## O. Plano de implementação sugerido

| Fase | Conteúdo | Por que nesta ordem |
|---|---|---|
| **0.5 — Segurança financeira** | Ligar RLS e revogar escrita do `anon` nas tabelas financeiras. Corrigir a política publicada. | **Pré-requisito.** Criar tabela de dinheiro com o `anon` escrevendo seria construir sobre o problema. |
| **1 — Ledger e Caixa da Empresa** | `caixa`, `caixa_movimento`, rotas de servidor, permissões, tela de extrato e saldo. Sem PDV ainda. | A tesouraria é o caso mais simples: não tem sessão, não tem fechamento, não depende do PDV. Prova o modelo com risco baixo. |
| **2 — Sangria e suprimento** | Transferência entre caixas, com os dois lados. Tela no PDV. | Depende só da Fase 1. É o que substitui a planilha. |
| **3 — Sessão e fechamento do PDV** | Abertura, fundo, fechamento, esperado × contado, divergência. | Depende de 1 e 2. É a parte que mais mexe na rotina do balconista. |
| **4 — Contas a receber no caixa** | `caixa_id` e `usuario_id` em `recebimentos`; campo de destino de verdade na tela. | Fecha a lacuna medida: 122/122 sem destino, 121/122 sem operador. |
| **5 — Contas a pagar no caixa** | Origem dos recursos; pagamento vira evento em vez de `UPDATE`. | Fecha o outro lado. |
| **6 — Normalização das formas de pagamento** | Tabela de domínio, migração dos textos livres, constraint. | Pode vir antes se a Fase 1 precisar; deixei aqui porque exige migrar dado existente. |
| **7 — Relatórios e fluxo de caixa** | Saldo consolidado do grupo, projeção, conciliação. | Só faz sentido com os movimentos existindo. |

---

## Estado dos testes

- `npm test`: **543 testes, 543 passando, 0 falhando** (154 suítes).
- `npx tsc --noEmit`: limpo.
- Cobertura por área: `precificacao` 14 arquivos, `marketplace` 12,
  `fiscal` 3, `contas` 2, `ia` 2, `pdv` 1, `commerce` 1, `dashboard` 1,
  `loja` 1, `mensagens` 1.
- **Cobertura relevante para caixa/financeiro: praticamente nenhuma.**
  `tests/contas/` cobre `origemDaConta` e `resumoFornecedor` — nenhum dos
  dois toca em dinheiro. `tests/pdv/` tem um arquivo só, sobre promoção por
  forma de pagamento. **Não há teste de persistência de venda, de
  recebimento, de pagamento de conta ou de qualquer cálculo de saldo.**
- Lint: os erros existentes são pré-existentes e concentrados em
  `no-explicit-any` nos componentes grandes; nenhum relacionado ao financeiro
  em particular.

---

## Itens não confirmados

1. **PDV externo (`vargasnexus-pdv`).** Não tenho acesso ao repositório. As
   chaves de permissão de caixa sugerem que ele tem telas de abertura/sangria,
   mas não há tabela onde isso pudesse ser gravado. **Não confirmado.**
2. **Se as 7 vendas `misto` vieram do PDV externo.** A divergência de
   vocabulário (`misto` × `multiplo`) é fato medido; a atribuição a um
   escritor específico é inferência.
3. **Por que `recebimentos.operador_nome` está nulo em 121 de 122.** O código
   passa a prop `operador`; se ela chega vazia ou se os registros são
   anteriores ao campo, não foi possível determinar sem histórico.
4. **Se `contas_receber` com `origem='fiado'` nunca existiu** ou foi
   convertido. Os 214 registros são todos `carteira`.
