# Inteligência Comercial — Fase 2

Margens estratégicas, preço efetivo e campanhas. Estado em **29/08/2026**.
Complementa [`precificacao-arquitetura.md`](precificacao-arquitetura.md), que
descreve a fundação da Fase 1.

---

## 1. A terceira camada

```
1. OBJETIVO ECONÔMICO   "quanto quero ganhar?"      regras.ts + margens.ts
2. ECONOMIA DO CANAL    "quanto custa vender?"      contexto.ts
3. ESTRATÉGIA COMERCIAL "como quero vender?"        precos.ts + campanhas.ts
                                                    estrategia.ts
                          ↓
                     cenarios.ts → motor.ts
```

**A regra que não pode ser quebrada:** campanha não calcula margem, atacado não
calcula margem, IA não calcula margem. Cada camada **propõe um preço**; quem
diz quanto sobra é sempre `avaliarPreco` → `motor.ts`.

---

## 2. As três margens

| Margem | Onde mora | Semântica |
|---|---|---|
| **Alvo** | **derivada** | a margem que o preço da regra entrega nesta economia |
| **Promocional mínima** | `precificacao_regra.margem_promocional_minima` (**coluna nova**) | até onde uma promoção pode ir sem aprovação |
| **Piso** | `precificacao_regra.margem_minima` | limite econômico absoluto |

### Por que a alvo é derivada

A Fase 1 registrou que "margem alvo = `objetivo_valor`". **Está errado, e foi
corrigido nesta fase.** `objetivo_valor` só é uma margem quando
`objetivo_tipo = 'margem_liquida'`; numa regra de `markup 2,5×` ele é um
multiplicador, e a margem que aquele markup entrega é ~34,7% — nada a ver com
o número 2,5 guardado na coluna. Gravar a margem alvo seria gravar um número
que envelhece sozinho quando custo, comissão ou frete mudam.

### O fallback quando a promocional é nula

**Nula não vira 15% nem nenhum número inventado.** Nula significa "esta regra
não tem política promocional declarada", e o limite promocional passa a ser o
próprio piso — a faixa promocional fica vazia e nada é aprovado
automaticamente como desconto aceitável.

É o fallback conservador: antes desta fase o sistema não tinha o conceito, e
uma migration não pode passar a autorizar desconto que ninguém autorizou.

### Classificação (`margens.ts`)

Com alvo 20%, promocional 15%, piso 10%:

| Margem efetiva | Classificação |
|---|---|
| ≥ 20% | `alvo` — meta atingida |
| ≥ 15% e < 20% | `promocional` — desconto aceitável |
| ≥ 10% e < 15% | `requer_aprovacao` — possível, fora da política |
| < 10% | `bloqueado` |

**Os limites são inclusivos**: margem exatamente igual ao piso é
`requer_aprovacao`, não `bloqueado`. Quem está no limite cumpriu o limite.

O guardrail é `podeExecutarSemAprovacao(classificacao)` — `alvo` e
`promocional` passam; os outros dois exigem gente.

---

## 3. Preço efetivo

### Precedência (`resolverPrecoEfetivo` em `precos.ts`)

1. **Campanha real vigente** — única origem confirmada pela plataforma, com
   janela datada e preço que ela informou.
2. **Promoção local vigente** — intenção do operador digitada aqui dentro;
   nenhuma sincronização confirma que a plataforma a pratique.
3. **Espelho** (`preco_venda`) — o que a última sincronização viu.

Campanha expirada, futura, encerrada ou em rascunho não entra, e o motivo vai
para os avisos em vez de sumir. Duas campanhas vigentes: vale a mais barata
(é o que o comprador paga), com aviso — costuma ser erro de cadastro.

### A vigência confia na JANELA, não no status

O `status` é retrato do instante em que o espelho foi sincronizado, e **a
sincronização de campanhas é manual neste sistema** (não há cron). Uma campanha
marcada como "programada" pode já ter começado. A janela é fato datado; o
status é opinião com validade. `encerrada` é a única exceção — é terminal.

### O desconto duplo, e por que é impossível aqui

Na Shopee, `preco_venda` recebe `current_price`, que **já é** o preço com
desconto. Tratar isso como preço estrutural e aplicar o desconto da campanha
por cima contaria o desconto duas vezes.

**`precos.ts` não multiplica nada.** O preço da campanha é LIDO de
`preco_promocional`; o preço base é LIDO de `preco_original`. Há um teste que
varre combinações e exige que o efetivo seja sempre um dos números lidos,
nunca um produto deles.

De quebra, a campanha **melhora** o que sabíamos: `preco_original` é o preço
estrutural que o espelho do anúncio não guarda em lugar nenhum.

---

## 4. Campanhas

### Modelo canônico (`campanhas.ts`) — sem tabela nova

`marketplace_promocoes` + `marketplace_promocao_itens` já cobriam quase tudo:

| Canônico | Coluna existente |
|---|---|
| `idExterno` | `id_externo` (discount_id) |
| `precoBase` | `preco_original` |
| `precoCampanha` | `preco_promocional` |
| janela, status | `inicio`, `fim`, `status` |
| específico da plataforma | `dados_brutos` (jsonb) |

**`plataforma` não virou coluna**: a campanha pertence a um canal, e o canal
tem plataforma. Derivar é mais honesto que guardar um valor constante.

**RLS**: as duas tabelas têm RLS **habilitada**, com policy copiada de
`marketplace_anuncios`.

> **Correção de 29/08/2026, medida no banco de produção.** Este documento
> afirmava que elas eram *as únicas* do domínio de precificação fora da dívida
> do `anon`. Está errado. `precificacao_regra`, `precificacao_config` e
> `precificacao_historico` também estão com RLS habilitada, com a policy
> `empresa_do_meu_grupo(empresa_id) OR is_system_admin()` — ligadas depois da
> criação, e por isso os arquivos `supabase-precificacao*.sql` (que as criam
> com RLS desabilitada) não descrevem mais o estado atual.
>
> Do domínio, seguem sem RLS apenas `precificacao_ml_comissao_cache` e
> `precificacao_ml_frete_cache`, que guardam tabela de comissão e escada de
> frete por canal, sem dado de cliente.
>
> A lição vale para além deste caso: **o SQL versionado diz o que foi feito uma
> vez; o banco diz o que vale agora.**

### Variação

Anúncio com variação tem um item por `model_id`. Se as variações tiverem
preços diferentes, o preço do anúncio não é único: `itemDoAnuncio` devolve
nulo e avisa, em vez de escolher uma — mesmo cuidado que o `aplicar` já tinha
ao recusar anúncio Shopee com variação.

### Adaptadores (`adaptadores.ts`)

| Plataforma | Estado |
|---|---|
| Shopee | leitura implementada (já existia; a Fase 2 passou a consumir o espelho) |
| Mercado Livre | **não implementado** — ver §6 |

---

## 5. Estratégia econômica do anúncio (`estrategia.ts`)

Calculada, **não persistida**. Composição de dados que já existem; uma tabela
guardaria números que envelhecem sozinhos.

Entrega: preço base e efetivo com origem, margem efetiva, **preço alvo**,
**preço promocional limite**, **preço piso** (os três pelo mesmo motor,
respeitando os regimes), as três margens, a classificação com motivo, a
campanha vigente, o estado comercial, as bandeiras e as oportunidades.

**Estado + bandeiras**, e não um enum único: um anúncio pode estar em promoção
E terminando E fora da política ao mesmo tempo.

- estado: `normal` · `em_promocao` · `sem_preco`
- bandeiras: `promocao_terminando`, `abaixo_do_alvo`,
  `fora_da_politica_promocional`, `abaixo_do_piso`, `sem_margem_para_promocao`,
  `preco_efetivo_inconsistente`, `sem_politica_promocional`

### Oportunidades determinísticas (sem IA, sem LLM)

`margem_para_promocao` (com o preço limite junto) · `sem_margem_para_promocao`
· `promocao_terminando` (com os dias) · `abaixo_do_piso` ·
`fora_da_politica_promocional` · `preco_efetivo_inconsistente`.

---

## 6. Mercado Livre — o que ficou e por quê

**Não implementado, deliberadamente.** A auditoria encontrou zero código de
promoção na integração do ML, e não foi possível fundamentá-lo:

1. A documentação oficial responde **HTTP 403** a este ambiente, em todos os
   domínios testados.
2. Não houve como sondar a API real: sem `.env.local`, não há token nem
   `seller_id`. Foi sondando a produção que comissão e frete reais foram
   descobertos na Fase 1.

Escrever o cliente a partir de resumo de busca repetiria o erro que a
publicação na Shopee custou — contrato descoberto erro a erro contra a API de
produção.

O que os resumos indicam (**não verificado**) e as **seis perguntas** que
precisam ser respondidas antes de implementar estão em
[`src/lib/precificacao/adaptadores.ts`](../src/lib/precificacao/adaptadores.ts).
Com `.env.local` e um token válido, um `GET` autenticado responde todas em
minutos.

---

## 7. Preço retido — a trava que cresceu

O `aplicar` do recálculo agora **retém** o preço de qualquer anúncio cujo preço
efetivo não venha da base — campanha real **ou** promoção local. Gravar
`preco_venda` nesse caso não muda o que o cliente paga, e faria a tela exibir
um número que não está no ar.

É o mesmo cuidado que `lib/marketplace/fila.ts` já tinha para campanha da
Shopee: *"gravar o preço retido faria o espelho jurar que o canal está com um
número que ele nunca recebeu"*.

---

## 8. Tempo

Toda resolução recebe `agora` como parâmetro. O resolvedor de contexto carrega
**um instante só** para todo o lote — numa varredura de 9 mil anúncios, o
último é avaliado contra o mesmo relógio do primeiro. Sem isso, uma campanha
que vence no meio da fila produziria dois critérios na mesma execução.

---

## 9. O que NÃO foi implementado

Entrada/saída automática de campanha, renovação, alteração automática de preço
base, atacado, preço por quantidade, IA, score, piloto automático, agenda.

**Nenhuma automação de alteração de preço ou de campanha foi habilitada.**
Observar, sincronizar, calcular, classificar e simular — só.
