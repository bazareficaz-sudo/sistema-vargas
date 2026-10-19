# Categorias de cliente (etiquetas)

Para marcar o tipo de cliente — Eletricista, Bombeiro hidráulico, Pedreiro, Gesseiro, Mecânico… — e filtrar depois. Um cliente pode ter várias.

## Banco (`supabase/migrations/20261020120000_cliente_categorias.sql`)

- `cliente_categorias`: nome (único na empresa, sem diferenciar maiúscula, até 40 letras) e cor (lista fixa: cinza, vermelho, laranja, amarelo, verde, azul, roxo, rosa).
- `cliente_categoria_vinculos`: cliente ↔ categoria. A empresa do vínculo vem do cliente (gatilho) e a categoria precisa ser da mesma empresa.
- Cliente unificado em outro: as categorias passam para o destino.
- `cliente_categorias_contagem` (view): clientes por categoria, sem os unificados.
- `whatsapp_conversas` ganha `categorias` (ids) no fim, para filtrar conversas.
- Acesso: só quem é da empresa (RLS `empresa_do_meu_grupo` ou admin do sistema); anon nada. O logado cria, renomeia, troca a cor e apaga.
- Nenhuma categoria é criada sozinha: a tela oferece as sugeridas (`SUGERIDAS` em `src/lib/clientes/categorias.ts`) quando a empresa não tem nenhuma.

## Telas

- **Clientes:** botão **🏷 Categorias** (criar, renomear, cor, apagar, quantos clientes); filtro por categoria; categorias embaixo do nome; caixas de seleção para **Marcar** ou **Tirar** uma categoria de vários clientes da página.
- **Cadastro do cliente** (gaveta): campo Categorias na aba Dados, gravado ao salvar; "+ Nova" cria ali mesmo.
- **Conversas do WhatsApp:** filtro "Categoria" ao lado de "Etapa"; bolinhas da cor de cada categoria na lista; em "Dados do contato", marcar e tirar com um clique (grava na hora). Só para quem já é cliente.
- **Relatório de clientes:** quadro "Por categoria" (clientes, quantos compraram, compras, total gasto, ticket médio, desde o primeiro registro); clicar filtra o relatório inteiro pela categoria (a nota RFM continua comparando com todos).

## Mensagem para uma categoria

Implementado como envio assistido: `docs/whatsapp-envio-categoria.md`.
