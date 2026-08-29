# Precificação de marketplaces — arquitetura

Estado após a **Fase 1 — fundação e estabilização do motor** (28/08/2026).
Escrito para quem for implementar a Fase 2 (margem alvo/promocional/piso,
preço efetivo, campanhas, estratégia comercial).

---

## 1. O fluxo, do anúncio ao resultado

```
anúncio + produto + canal
          │
          ▼
  contexto.ts  ← config do canal (taxas)
               ← custo (produto ou soma do kit)
               ← comissão real do ML (API + cache 12 h)
               ← frete real do ML   (API + cache 24 h)
               ← precos.ts (base / promocional / efetivo)
          │
          ▼
   EconomiaResolvida          regras.ts → objetivo econômico
          │                        │
          └──────────┬─────────────┘
                     ▼
                cenarios.ts
         avaliarPreco · precificarPorObjetivo · precificarPorRegra
                     │
                     ▼
                  motor.ts        ← PURO. sem I/O, sem banco, sem API
                     │
                     ▼
              Resultado + regime + memória de cálculo + avisos
```

**A regra que sustenta tudo:** `motor.ts` não conhece banco, rede nem
marketplace. Quem precisa de dado externo resolve **antes**, em `contexto.ts`,
e entrega números prontos.

---

## 2. Os arquivos e o que cada um pode fazer

| Arquivo | Faz I/O? | Papel |
|---|---|---|
| `motor.ts` | **não** | matemática financeira: regimes, fórmula fechada, memória de cálculo |
| `precos.ts` | **não** | vocabulário canônico de preços de anúncio |
| `regras.ts` | só `buscarRegras` | hierarquia de objetivos e o piso de margem |
| `cenarios.ts` | **não** | as três portas de entrada do motor |
| `contexto.ts` | **sim** | resolve config, custo, comissão e frete num só lugar |
| `recalculo.ts` | sim | varredura em massa sobre o contexto |
| `config.ts` | sim | leitura/gravação de `precificacao_config` + presets |
| `mlComissao.ts` / `mlFrete.ts` | sim | medição na API do Mercado Livre |
| `competitividade.ts` | sim | sugestão de preço do ML |
| `analise.ts` | não | diagnósticos determinísticos |

Quem for acrescentar campanha, atacado ou IA: a camada nova **propõe um
preço** e chama `avaliarPreco`. Ela não calcula margem.

---

## 3. As três portas do motor (`cenarios.ts`)

```ts
avaliarPreco(economia, preco)            // "se eu vender por isto, quanto sobra?"
precificarPorObjetivo(economia, objetivo) // "que preço me dá esta margem?"
precificarPorRegra(economia, regra)       // idem, pela regra que venceu, com piso
```

As três devolvem um `Cenario`: `resultado` (preço, cada dedução em reais,
lucro, margem, markup, ROI, **regime usado**, memória de cálculo, avisos),
`saude`, `lucroSobreCusto` e `valido`.

`avaliarPreco` **não arredonda**: o preço candidato veio de fora (campanha,
faixa de atacado, sugestão de competitividade) e mexer nele responderia outra
pergunta.

---

## 4. `ContextoPrecificacao` — o que ele resolve, e como avisa

Além dos números, o contexto diz **de onde cada um saiu**. Isso não é enfeite:
é a diferença entre um preço confiável e um palpite.

| Campo | Valores |
|---|---|
| `origemConfig` | `canal` · `plataforma` · `preset` |
| `origemCusto` | `produto` · `kit` · `manual` |
| `origemComissao` | `tabela` · `simples` · `api_ml` · `api_ml_cache` · `api_ml_sem_categoria` · `api_ml_indisponivel` |
| `origemFrete` | `config` · `api_ml` · `api_ml_cache` · `api_ml_sem_medidas` · `api_ml_indisponivel` |

`descreverOrigem(ctx)` resume as três numa linha para a tela e o histórico.

**Caches são por execução**, não globais: uma varredura de 9 mil anúncios
resolve a config de cada canal uma vez, a comissão de cada categoria uma vez e
o frete de cada peso cobrável uma vez. O cache duradouro é o do banco.

**`resolvidoEm` é um instante só para todo o lote.** O anúncio da última página
é avaliado contra o mesmo relógio do da primeira — senão uma promoção que
vence no meio da fila produz dois critérios na mesma execução.

---

## 5. Mapa semântico dos preços

### 5.1. `marketplace_anuncios`

| Campo | Significado real | Quem grava | Quem lê | Nulo? |
|---|---|---|---|---|
| `preco_venda` | **preço efetivo espelhado do canal** — não é "preço de tabela" | sync do ML (`rawItem.price`) e da Shopee (`current_price`), `fila.ts`, `aplicar` do recálculo, `autoStockSync` | `precos.ts`, telas de anúncio | não (default 0) |
| `preco_promocional` | **intenção local**, digitada no editor de anúncio | só o editor manual (`AnunciosClient` → `anuncios/[id]/editar`) | `precos.ts` | sim |
| `promo_inicio` / `promo_fim` | janela da intenção local | idem | `precos.ts` (**passou a ler na Fase 1**) | sim |
| `categoria_externa` | `category_id` do canal — é a chave da comissão real do ML | sync | `contexto.ts` | sim |

**A armadilha:** `preco_venda` já vem **com** o desconto de campanha aplicado.
A Shopee grava `current_price`; o ML grava `price`, que é o que o comprador vê.
Tratar esse campo como "preço base" na Fase 2 seria errar por construção.

**Medição de 27/08/2026** (registrada em `supabase-marketplace-promocoes.sql`):
os 1.286 anúncios Shopee tinham `preco_promocional`, `promo_inicio` e
`promo_fim` **nulos** — nenhuma sincronização escreve neles.

### 5.2. Campanha de verdade — `marketplace_promocoes` + `marketplace_promocao_itens`

| Campo | Significado |
|---|---|
| `preco_original` | preço antes da campanha, informado pela Shopee |
| `preco_promocional` | preço dentro da campanha |
| `inicio` / `fim` / `status` | janela da campanha (`programada`/`ativa`/`encerrada`) |

Tabela separada porque, na Shopee, desconto é **campanha da loja** (nome,
janela, muitos itens), não atributo do anúncio. **É daqui que a Fase 2 deve
tirar o preço promocional de marketplace** — não das três colunas do anúncio.

### 5.3. Promoção do balcão — `produtos`

`preco_venda`, `preco_promocional`, `promocao_ativa`, `promocao_inicio`,
`promocao_fim`, `precos_quantidade`. É **outra coisa**: a promoção do PDV, com
regra própria em `lib/produtos/promocao.ts` (`promocaoVigente`). Marketplace
tem margem própria; ligar as duas é decisão de tela, não de banco.

### 5.4. Vocabulário canônico (`precos.ts`)

```
BASE        preco_venda            o que o canal cobra hoje (espelho)
PROMOCIONAL preco_promocional      intenção local, dentro da janela local
EFETIVO     o que vale agora       promocional vigente, senão a base
```

`precosDoAnuncio(anuncio, agora)` devolve os três mais
`promocaoLocalVigente` e `origemEfetivo`. **Nenhum campo novo foi criado** — o
vocabulário é uma leitura correta do que já existe.

Quando a Fase 2 trouxer a campanha, `origemEfetivo` ganha um terceiro valor
(`campanha`) e a tela não muda de forma.

---

## 6. Regimes — por que a matemática não pode ser simplificada

Comissão muda por faixa de preço; frete grátis liga acima de um valor; o frete
importado do ML é outra escada por preço. Cada combinação em que **tudo é
constante** é um regime. O motor:

1. monta os regimes (cruzando as escadas);
2. resolve a fórmula fechada em cada um;
3. descarta a solução que não pertence ao próprio regime;
4. entre as válidas, fica com a **mais barata** (mais competitiva, e a margem
   pedida está garantida nas duas);
5. quando nenhuma fecha, devolve zero **com aviso** — nunca um número que
   finge estar certo.

Medido no teste: custo R$ 30, margem 20% → **R$ 56,67**. Um centavo acima de
R$ 78,99 o frete entra e o lucro cai de R$ 29,19 para R$ 7,20. É esse degrau
que impede iterar ou usar média.

`Resultado.regime` diz qual trecho valeu: comissão, frete e a faixa de preço.

**Consequência para campanhas:** um preço promocional pode cair em **outro
regime**. `105 → 79` não é "menos X%" em cima de tudo: comissão, tarifa e frete
podem mudar juntos. Por isso a Fase 2 tem de **avaliar o preço de campanha
pelo motor**, nunca aplicar percentual sobre a margem do preço base.

---

## 7. Hierarquia de regras

```
produto 100 · categoria 60 · marca 50 · canal 30 · plataforma 20 · empresa 10
+5 quando a regra restringe canal · + min(prioridade,4)×0,1 para desempate
```

Saltos grandes de propósito: o bônus de canal **desempata dentro do nível** e
nunca faz marca passar na frente de categoria. `resolverRegra` devolve a
vencedora, as candidatas ordenadas **e as descartadas com motivo**.

`margemMinima` é **piso, não alvo**: só interfere quando o objetivo ficaria
abaixo dela, e quando interfere o aviso diz de quanto para quanto o preço
subiu.

**Para a Fase 2 (três margens):** `margem alvo` é o `objetivoValor` que já
existe; `margem piso` é a `margemMinima` que já existe; falta apenas a
`margem promocional mínima`, que é uma terceira coluna em
`precificacao_regra` e um segundo piso dentro de `aplicarRegra`. A hierarquia
não precisa mudar.

---

## 8. Limites, e por que existem

| Limite | Onde | Motivo |
|---|---|---|
| 1.000 linhas/página | `recalculo.ts` | teto do PostgREST; **exige `.order()`**, senão repete e perde linha |
| 30.000 anúncios/canal | `recalculo.ts` | rede de segurança contra laço infinito |
| 500 itens na prévia | `recalculo.ts` | tamanho de resposta e da tela |
| 400 produtos na busca | `recalculo.ts` | os ids viajam dentro da URL da consulta |
| 200 por lote no aplicar | `aplicar/route.ts` | tempo da função × chamadas ao marketplace |
| 40 na competitividade | `analise/route.ts` | uma chamada de API por anúncio |
| 9 e 8 preços de sonda | `mlComissao` / `mlFrete` | resolução da escada × custo de chamada |
| cache 12 h / 24 h | idem | limite de requisição da API do ML |

Nenhum deles é decoração: remover sem substituir troca um resultado parcial
declarado por uma falha silenciosa.

---

## 9. Testes

`npm test` — 80 casos, sem banco e sem rede.

| Arquivo | Cobre |
|---|---|
| `tests/precificacao/motor.test.ts` | degraus de comissão e frete (78,99 / 79,00 / 79,99 / 80,00), cada objetivo, ida e volta em 15 combinações, arredondamento, caso impossível, frete importado, base custo × preço, memória de cálculo |
| `tests/precificacao/regras.test.ts` | hierarquia nível a nível, bônus de canal, prioridade, rastreabilidade, piso de margem |
| `tests/precificacao/precos.test.ts` | base/promocional/efetivo, janela, dado sujo |
| `tests/precificacao/cenarios.test.ts` | equivalência precificar ↔ avaliar, regime, lote de cenários, **regressão da paginação** |

A propriedade que garante a fonte única de verdade:

> dada a mesma `EconomiaResolvida`, precificar por objetivo e depois avaliar o
> preço resultante devolvem exatamente a mesma conta.

---

## 10. O que NÃO foi feito nesta fase

Campanhas, atacado, preço por quantidade, agenda comercial, score, IA e piloto
automático continuam fora — de propósito. A fundação existe para recebê-los.
