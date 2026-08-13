# Continuidade — onde paramos

Anotações para retomar o trabalho numa sessão nova. Não é documentação do
sistema: é o estado de quem estava com a mão na massa.

Última atualização: 13/08/2026

---

## Em andamento

### Nuvemshop — módulo de escrita

A Nuvemshop era só leitura (importava catálogo e pedidos, não devolvia nada).
Canal: **LV Eficaz**, loja 1004517, 235 anúncios, **223 mapeados (95%)**.

**Pronto e validado em produção:**
- `src/lib/nuvemshop/write.ts` — `atualizarPrecoEstoque` e `publicarProduto`.
- Ligado em `src/lib/marketplace/envio.ts` (a fila não recusa mais a Nuvemshop).
- Envio de partida executado: **101 atualizados**, **27 zerados** por estoque
  negativo, 81 já corretos, 14 fora por falta de preço.

**Detalhe estrutural que não é óbvio:** na Nuvemshop preço e estoque ficam na
**variante**, não no produto. Todo produto tem pelo menos uma — o que a loja
mostra como "produto simples" é, na API, um produto com uma variante só.
Não existe "pausado": o equivalente é `published: false` (sai da vitrine, o
produto continua existindo com o mesmo id).

**Falta (próxima fase):**
1. **Criar anúncio** — `POST /products` com a variante embutida. Hoje o botão
   "+ Criar anúncio" no Mapa de Anúncios **não faz nada** para a Nuvemshop:
   `MapaAnunciosClient.tsx` só monta modal para `shopee` e `mercadolivre`
   (linhas ~371 e ~377). É o módulo maior: payload, imagens, categorias.
2. **UI de envio manual** — o botão "Preço/estoque" da tela de Anúncios ainda
   não oferece a Nuvemshop.

### Qualidade dos anúncios — parou na metade

`supabase-marketplace-qualidade.sql` **já foi rodado**. As colunas
`qualidade_health / _score / _faltas / _em` existem e os 8.117 anúncios foram
avaliados. O cálculo roda a cada sincronização (`src/lib/marketplace/qualidade.ts`).

**Falta a tela:** coluna Qualidade na listagem de Anúncios, filtro por falta
("mostrar os 3.537 sem EAN") e painel por anúncio com os botões que resolvem
cada pendência.

**Achado importante, medido — não repetir o erro:** o checklist do sistema
**não prevê** o `health` oficial do ML. Anúncios com health ≥0,80 dão score
médio 56; abaixo de 0,80, 54. A tela deve mostrar **o health do ML** como a
nota no Mercado Livre, e usar o checklist só como lista do que falta. Para
nota itemizada de verdade no ML o caminho é o endpoint `/items/{id}/health`
(7.692 chamadas, passada à parte).

Números por canal: ML Eficaz 4.986 anúncios (health 0,77), ML Ouro 2.025
(0,70), Shp Eficaz 675, Shp Ouro 431.

### Celular — fatias feitas, resto pendente

Feito: tag `viewport` (faltava, era a causa raiz do texto minúsculo), menu em
gaveta abaixo de `md`, tela de Produtos (rolagem própria na tabela, cabeçalho
e paginação empilhados), tela de Anúncios em cards para o mapeamento.

**Duas armadilhas que já custaram uma rodada cada:**
- O trilho do menu foi feito para mouse: abre no `onMouseEnter` e o clique
  **fecha**. Sem hover no celular, tocar não fazia nada. Resolvido com
  `alternarPainel`. Se aparecer padrão parecido em outra tela, é o mesmo.
- Painel posicionado em `left-[216px]` com z-index menor que a gaveta ficava
  invisível no celular.

**Falta:** 82 tabelas ainda sem `overflow-x-auto` e ~144 grids de 3+ colunas
sem prefixo responsivo. Priorizar pelas telas que o Silvano usa no celular —
não vale passar por 99 telas.

---

## Pendências do Silvano (não são código)

- **14 produtos sem preço** no cadastro. Não é problema da Nuvemshop: afeta
  Shopee e ML também.
- **27 produtos com estoque negativo.** A vitrine foi zerada, mas o saldo
  negativo no sistema continua — provavelmente entrada que faltou dar.
- **Contador**: confirmar se a empresa é contribuinte **substituído** (ST vem
  recolhido do fornecedor). Disso depende a tabela de conversão de CFOP por
  modelo — ver abaixo.

---

## Decidido mas não implementado

### CFOP por modelo de documento (NF-e × NFC-e)

Problema real: 49 produtos com CFOP 5403, que a **NFC-e recusa**. O sistema
hoje **só emite NFC-e** (`ModeloDocumento: 65` fixo); NF-e não existe.

Desenho aprovado: **derivação automática com exceção**, não dois campos para
preencher em 14 mil produtos. Tabela explícita 5403→5405, 5401→5405 para
NFC-e, mais um campo opcional `cfop_nfce` por produto.

**Não implementar antes da resposta do contador** — se a empresa for
substituída, 5405 vale para os dois modelos e basta corrigir os 49.

---

## Consertos recentes que vale conhecer

- **NFC-e — desconto rateado.** O PDV grava o desconto no cabeçalho da venda,
  e a emissão só lia o desconto por item. Toda venda com desconto era
  rejeitada (Rejeição 865). Corrigido com rateio proporcional, último item
  absorvendo a sobra.
- **WhatsApp — anexo nunca chegava.** Dois defeitos somados: faltava a
  extensão no caminho (`/send-document/pdf`, exigência da Z-API) e o
  resultado do envio era descartado, então a falha era silenciosa.
- **Shopee** — imagem WebP recusada (agora convertida para JPEG) e campo
  `condition` obrigatório que não era enviado.
- **Dashboard** — entradas manuais não entravam em "Compras do mês": a
  consulta filtrava por `data_emissao`, que entrada manual não tem (4 de 31
  preenchidas). Passou a usar a data de entrada quando não há emissão.

---

## Como trabalhar aqui

- **Ler o dado de produção antes de afirmar qualquer coisa.** Vários erros
  desta sessão vieram de deduzir pelo código. Há scripts de consulta rápida
  com `@supabase/supabase-js` + `SUPABASE_SERVICE_ROLE_KEY` do `.env.local`.
  Rodar de dentro de `pdv-vargas-web/`, senão não resolve o módulo.
- **`npx tsx arquivo.ts`** permite chamar as libs reais (foi assim que a
  escrita da Nuvemshop foi testada). Top-level await não funciona: envolver
  em `async function main()`.
- **Não abro a aplicação.** Nenhuma mudança de tela desta sessão foi
  conferida visualmente — a verificação é do Silvano, e foi ela que pegou os
  dois bugs do menu no celular.
- **Migração antes do deploy.** Código que grava coluna nova quebra o
  upsert INTEIRO se o SQL não tiver rodado. Já aconteceu com a qualidade;
  `upsertAnuncio` ganhou uma proteção que remove os campos e regrava.
- **Este arquivo fica desatualizado sozinho.** Atualizar ao terminar cada
  fatia, ou ele vira mentira com aparência de verdade.
