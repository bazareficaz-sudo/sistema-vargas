# Inteligência Comercial — Fase 3

Estratégia comercial, preço por quantidade e recomendações determinísticas.
Estado em **29/08/2026**. Complementa
[`precificacao-arquitetura.md`](precificacao-arquitetura.md) (Fase 1) e
[`precificacao-fase2-comercial.md`](precificacao-fase2-comercial.md) (Fase 2).

---

## 1. O achado que definiu a fase

**O motor cobrava o frete por unidade. Frete é custo por pedido.**

Avaliar a faixa "10+ unidades" pelo motor anterior cobraria **dez fretes**, e
um preço de atacado saudável apareceria como prejuízo. Qualquer sugestão de
atacado construída antes desse conserto estaria errada por construção.

A evidência não é dedução — saiu de como os pedidos reais são gravados:

| Plataforma | Onde o frete mora | Arquivo |
|---|---|---|
| Shopee | `actual_shipping_fee` **no pedido** | `lib/shopee/orders.ts` |
| Mercado Livre | `/shipments/{id}`, não no item | `lib/mercadolivre/orders.ts` |

Medido depois do conserto, custo R$ 30 e preço R$ 120:

| Quantidade | Frete/un | Lucro/un | Lucro do pedido |
|---|---:|---:|---:|
| 1 | R$ 22,00 | R$ 35,20 | R$ 35,20 |
| 10 | R$ 2,20 | R$ 55,00 | **R$ 550,00** |

Multiplicar o lucro unitário de uma unidade por dez daria R$ 352 — **R$ 198 de
erro por pedido**.

---

## 2. Semântica dos custos multiunidade

| Custo | Natureza | Como ficou | Confiança |
|---|---|---|---|
| Produto | por unidade | escala com N | certa |
| **Frete** | **por pedido/envio** | **rateado por N** | **medida no código dos pedidos** |
| Comissão % | sobre a receita | escala com N | certa |
| Comissão fixa | ? | tratada **por unidade** | **não verificada** |
| Imposto % | sobre faturamento | escala com N | certa |
| Embalagem | depende | `porPedido` opcional, default por unidade | configurável |
| Taxas / extras | depende | `porPedido` opcional | configurável |

A fórmula que resume tudo:

```
fixo por unidade = fixos unitários + (frete + fixos por pedido) / N
```

**A parcela FIXA da comissão ficou como por unidade**, e isso está declarado no
cabeçalho de `motor.ts`. `mlComissao.ts` mede `fixed_fee` para **um** item no
preço X, e a documentação oficial responde 403 a este ambiente. É a leitura
conservadora: **superestima o custo do atacado, nunca a margem**.

As **faixas** de comissão e de frete continuam indexadas pelo preço
**unitário** — a sonda do ML usa `item_price`. Por isso os regimes não mudaram
de forma, e os 152 testes anteriores passaram sem alteração nenhuma.

---

## 3. Preço por quantidade (`quantidade.ts`)

**Reaproveita o formato que já existia.** `produtos.precos_quantidade` (JSONB,
máx. 3 faixas) já servia o PDV, com `faixasDoProduto()` e `precoPorQuantidade()`
em `lib/produtos/promocao.ts`. Nenhum formato novo foi inventado — o que muda é
que aqui cada faixa passa pela economia do canal, que o balcão não tem.

### Por que não "3+ = -5%, 5+ = -10%"

Percentual fixo ignora a economia real. Quando a quantidade sobe, duas forças
puxam para lados opostos: o frete dilui (a favor) e o preço cai (contra). Um
desconto de 15% é folgado num item que paga R$ 22 de frete e suicida num que
não paga frete nenhum.

### Como a sugestão é montada

| Situação | Critério |
|---|---|
| **Com** política promocional declarada | cada faixa consome uma fração da folga entre a margem alvo e o mínimo promocional; a última chega ao limite e **nunca o ultrapassa** |
| **Sem** política declarada | as faixas **mantêm a margem alvo** e mesmo assim saem mais baratas, pela diluição do frete — desconto que não custa margem |
| Sem política **e** sem frete a diluir | **nenhuma faixa**, e o motivo é dito |

O guardrail é o **teto da sugestão**, não algo conferido depois.

Uma faixa que não sai mais barata que o preço de uma unidade é descartada, com
aviso — inclusive a primeira, que não tem antecessora para comparar.

---

## 4. Capacidades do canal (`capacidades.ts`)

**Estratégia calculada ≠ estratégia publicável.** Quatro estados, porque um
booleano obrigaria a chamar de "não suportado" tudo que apenas não foi
conferido:

| Estado | Significado |
|---|---|
| `suportado` | conferido: a plataforma faz e o sistema sabe usar |
| `nao_suportado` | conferido: a plataforma não faz |
| `nao_verificado` | ninguém conferiu — **não é o mesmo que não suportado** |
| `indisponivel_por_credencial` | falta conexão/escopo — reversível |

| | Shopee | Mercado Livre |
|---|---|---|
| Campanhas — leitura | **suportado** | não verificado (403 na doc, sem credencial) |
| Campanhas — escrita | não verificado | não verificado |
| Preço por quantidade | não verificado | não verificado |
| Variações | suportado | suportado |
| Subsídio de campanha | não verificado | não verificado |
| Webhook de promoção | não verificado (sync manual) | não verificado |

A tela **não esconde** a funcionalidade quando o canal não publica: mostra
"economicamente válido, publicação no canal ainda não disponível".

---

## 5. Sinais comerciais (`sinais.ts`)

Estoque e vendas **não entram no motor financeiro**. Não mudam comissão, frete
nem margem: mudam a **prioridade** de uma recomendação.

### Estoque

A fonte correta já existia e já é a do marketplace: `estoqueDoSistema()` +
`estoqueUnificadoDeProdutos()`, o mesmo par que `lib/marketplace/fila.ts` usa
para decidir o que enviar ao canal. O comentário de `estoqueUnificado.ts` é
explícito: *"este número é o que vai para os ANÚNCIOS dos marketplaces. O PDV
continua vendendo do estoque da própria empresa"*.

A unificação entre empresas do grupo **só vale quando explicitamente ligada**
(`empresa_config_estoque.estoque_unificado_ativo` + participantes). Este módulo
**não soma grupo por conta própria**.

### Cobertura

`estoque ÷ média diária recente`. Os casos que uma divisão ingênua erra, e que
aqui têm resposta própria:

| Caso | Resposta |
|---|---|
| Sem venda na janela | cobertura `null`, nível `sem_venda` — não divide por zero |
| Estoque zero | cobertura `0`, nível `sem_estoque` — decide antes de qualquer média |
| Produto novo (janela < 14 dias) | número existe, `confiavel: false` |
| Pico solitário (um pedido > 60% do volume) | `confiavel: false` — é evento, não ritmo |

Limites de curta/longa (15 e 90 dias) são **parâmetro**, não constante de tela.

---

## 6. Recomendações determinísticas (`recomendacoes.ts`)

Sem IA, sem LLM, sem tabela. **Três coisas separadas:**

```
DIAGNÓSTICO   o que os números dizem       "margem alta, estoque parado"
RECOMENDAÇÃO  o que vale considerar        "avaliar promoção"
AÇÃO          o que uma PESSOA pode fazer  "simular desconto"
```

Nada aqui executa nada. Toda recomendação carrega **evidências** — os números
que a sustentam, nunca caixa-preta.

### Prioridades

`critica` → `alta` → `media` → `baixa` → `informativa`, centralizadas em
`ORDEM_PRIORIDADE`. Nenhuma regra de prioridade mora na tela.

### Precedência — o guardrail vence sempre

| Condição | Efeito |
|---|---|
| **Abaixo do piso** | elimina **toda** sugestão de descer preço |
| **Sem estoque** | elimina oportunidade comercial — não se promove o que não se entrega |
| **Sem regra / sem custo** | elimina sugestão de preço — a conta que a sustentaria não existe |
| **Estoque curto** | **rebaixa** a prioridade de promover, sem apagá-la |

Isso é testado: um item abaixo do piso, com estoque parado e atacado
economicamente viável, **não** recebe nenhuma recomendação de baixar preço.

---

## 7. O que ficou de fora, e por quê

| Item | Motivo |
|---|---|
| Central de Oportunidades como tela nova | construir tela sobre dados que ninguém viu rodar (Shopee com 0 campanha medida, ML fora) repetiria o erro que estas três fases evitaram |
| Recomendações ligadas ao recálculo em massa | exige consultas de estoque e vendas em lote que não podem ser verificadas sem banco. A camada está pronta e testada; falta o `SELECT` |
| Persistência de estratégia comercial | `produtos.precos_quantidade` já guarda faixas do ERP. Persistir faixas **por canal** só se justifica quando algum canal publicá-las — hoje nenhum, comprovadamente |
| Campanhas do Mercado Livre | inalterado desde a Fase 2: doc 403, sem credencial para sondar |
| Qualquer automação | por determinação da fase |

---

## 8. Testes

`npm test` — **223 casos** (eram 152 ao fim da Fase 2), sem banco e sem rede.

| Arquivo | Cobre |
|---|---|
| `quantidade.test.ts` | compatibilidade com N=1, rateio do frete, o erro de R$ 198 medido, custos `porPedido`, memória de cálculo |
| `faixas.test.ts` | avaliação na quantidade certa, sugestão pelos limites, guardrail como teto, cabe-atacado |
| `sinais.test.ts` | os quatro casos da cobertura, quatro estados de capacidade |
| `recomendacoes.test.ts` | prioridade, evidências, e **o guardrail vencendo** |

---

## 9. Princípio preservado

```
DADOS REAIS → CONTEXTO → MOTOR → ESTRATÉGIA → CENÁRIOS → GUARDRAILS → USUÁRIO
```

Campanha propõe preço. Atacado propõe preço. Estoque e vendas mexem na
prioridade. **Só o motor calcula a economia**, e nenhuma camada ultrapassa o
guardrail em silêncio.
