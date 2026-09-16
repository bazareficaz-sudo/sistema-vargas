# Antes de enviar o questionário da TikTok Shop

Este arquivo é interno. Não vai junto com o envio.

> ✅ **APROVADO em 15/09/2026.** O Partner Center mostra "Você passou na
> avaliação de segurança e privacidade de dados". Este arquivo fica como
> histórico do que foi preciso para chegar lá. Os próximos passos de
> publicação (avaliação de anúncios e avaliação de aplicativo) não são mais
> sobre segurança — ver nota no rodapé.

A política e o pacote de evidências foram escritos para descrever a realidade —
não uma realidade desejada. Os itens abaixo são as afirmações que **ainda não são
verdade hoje**. Cada um precisa estar feito antes de a resposta ser enviada, senão
estaremos atestando controle inexistente a um parceiro — que é exatamente o tipo
de coisa que, se o revisor descobrir depois, encerra a conversa de vez.

Ordem pensada para o risco cair primeiro.

> **Achado em 13/09/2026:** o formulário ao vivo no Partner Center ainda tem
> as respostas da tentativa rejeitada — em português, uma delas ainda citando
> Google Cloud Platform, e o link da pergunta 1 apontando para a página de
> privacidade em vez da de segurança (com o anexo errado: print da política
> de privacidade, não da política de segurança assinada). A correção já
> existe nos documentos deste diretório, mas nunca foi colada no formulário.
> Guia campo a campo, com o texto pronto para colar, em
> [PREENCHER-FORMULARIO-TIKTOK.md](PREENCHER-FORMULARIO-TIKTOK.md). Dois
> pontos daquele guia pedem uma decisão sua antes de colar: a pergunta 3
> (antivírus, item 3 do guia) e principalmente a pergunta 9 (se a exposição
> contínua da tabela `clientes` sem RLS conta como violação a notificar —
> não decidi isso por vocês).

> **Domínio:** em 02/08/2026 o sistema passou de `vargasnexus.com.br` para
> `www.sistemavargas.com.br`. Toda URL citada nos outros dois documentos já está
> no domínio novo. Antes de enviar, confirme que os painéis de desenvolvedor da
> Shopee, do Mercado Livre e da TikTok Shop têm a URL de retorno no domínio novo
> — OAuth registrado no domínio antigo falha na hora de conectar.

---

## 1. Rodar `supabase-fechar-escrita-anonima.sql` ✅ FEITO EM 02/08/2026

O anônimo tinha SELECT, UPDATE e DELETE em 14 tabelas — dava para apagar as 504
vendas, alterar os 14.423 produtos e editar os 44 clientes sem login.

Aplicado e reconferido na produção: a consulta de verificação devolveu as 9
linhas esperadas. Nenhum DELETE em lugar nenhum, `vendas` e `venda_itens` só
aceitam INSERT, e `usuarios_pdv`/`vendedores`/`depositos` não aceitam escrita.

**Fechado em 13/09/2026:** confirmado com o Silvano que o PDV externo evoluiu
e vende normalmente todo dia desde a mudança — não travou o balcão. Item 1
concluído, nenhuma ação restante.

## 2. Credenciais expostas — decidido em 02/08/2026 ✅ RESOLVIDO

A tabela `sistema_integracoes` esteve legível sem login. O acesso foi fechado e
conferido no mesmo dia.

- [x] **Brasil NFe UserToken** — trocado. Era o de maior dano: permite emitir
      documento fiscal no CNPJ da empresa.
- [ ] Shopee `partner_key` — **mantida, por decisão sua**
- [ ] Mercado Livre `app_secret` — **mantida, por decisão sua**
- [ ] WhatsApp Z-API — **mantida, por decisão sua**

O motivo de manter foi o custo de reconectar canal no meio da operação. A
decisão é legítima e está documentada como tal — a §11 da política foi reescrita
para descrever avaliação por risco em vez de rotação incondicional, e o pacote de
evidências declara o episódio abertamente na B4.

**Isso não fica em aberto para sempre.** Marque uma data para revisitar as três.
Enquanto elas estiverem em uso, quem porventura as tenha copiado continua com
elas — fechar a porta não recolhe o que já saiu.

Se um dia trocar: gera credencial nova no painel do serviço, substitui no
Supabase e reconecta o canal. Depois marque o item aqui e reverta a §11 para
rotação incondicional, que é a redação mais forte.

## 3. Ligar MFA em todas as contas administrativas ⛔ BLOQUEIA O ENVIO

A política §4 afirma MFA obrigatório em conta administrativa. Ligue em:

- [ ] Provedor de hospedagem
- [ ] Provedor do banco de dados
- [ ] Repositório de código
- [ ] Registrador do domínio
- [ ] Console de desenvolvedor da Shopee
- [ ] Console de desenvolvedor do Mercado Livre
- [ ] Console de desenvolvedor da TikTok Shop

O pacote de evidências oferece print de MFA ligado como anexo 5. Sem isso, o
anexo não existe.

## 4. Confirmar o plano do banco de dados (backup)

A política §12 afirma backup automático com recuperação a um ponto no tempo. Isso
depende do plano contratado — o plano gratuito não garante. Confira no painel do
provedor e:

- se tiver: nada a fazer;
- se não tiver: ou sobe o plano, ou **corrija a §12** antes de enviar.

**Checado em 13/09/2026 via API do provedor:** a organização está no plano
**pago** (não é o gratuito), o que já descarta o pior caso. Mas a API não
expõe se o complemento de *point-in-time recovery* está de fato contratado —
isso só aparece no painel, em Database → Backups. Confirme lá especificamente
a linha de PITR antes de assinar a §12 como está.

## 5. Preencher e assinar a política

Preenchido em 02/08/2026 nos três documentos e na página pública:

- [x] Razão social **Ouro e Prata Elétrica**, CNPJ **43.103.402/0001-24**
- [x] Responsável pela segurança: **Silvano Nunes Vargas**, Owner
- [x] Data de adoção: **2 de agosto de 2026**
- [x] Prazos da seção C: 31/10/2026 para guarda de permissão e CSP
- [x] **Telefone** de contato de segurança: **+55 21 98294-9060** — preenchido
      em 13/09/2026 nos três documentos
- [x] Criar `security@sistemavargas.com.br` e `privacidade@sistemavargas.com.br`
      — feito em 13/09/2026, confirmado pelo Silvano. (A checagem de DNS logo
      depois ainda não achou o registro MX — o serial do SOA mudou, sinal de
      DNS atualizado há pouco, então é provavelmente só propagação. Vale
      mandar um e-mail de teste para as duas caixas antes de confiar nelas
      nas respostas do questionário.)
- [ ] Assinar e datar — PDF gerado em 13/09/2026
      ([Information-Security-Policy-v1.0.pdf](Information-Security-Policy-v1.0.pdf)),
      falta só o Silvano assinar (nome, cargo, assinatura e data em branco na
      última página) e depois subir esse PDF assinado na pergunta 1 do
      formulário, no lugar do print errado da política de privacidade

**Confira duas coisas antes de assinar:**

1. **A razão social está completa?** No cartão CNPJ ela costuma vir com sufixo
   (LTDA, ME, EIRELI). Se o seu tiver, acrescente — documento jurídico com razão
   social pela metade dá margem a questionamento.
2. **É este o CNPJ da conta de desenvolvedor da TikTok Shop?** Se a conta lá
   estiver em outro CNPJ, o avaliador vê divergência entre quem assina a política
   e quem pede a integração. É exatamente o tipo de inconsistência que derrubou
   a primeira tentativa.

Depois exporte para PDF. Política sem data e sem assinatura é lida como modelo
baixado da internet — foi exatamente por falta de evidência que a primeira
tentativa caiu.

## 6. Preencher os campos do pacote de evidências

Em `TIKTOK-SHOP-EVIDENCE-PACK.md`: dados de contato, e as datas da seção C
("o que ainda estamos construindo"). Sugestão para as duas primeiras: 90 dias a
partir do envio. Coloque data que você consegue cumprir — data estourada num
compromisso escrito é pior do que não ter prometido.

## 7. Tirar os prints dos anexos

1. Cabeçalhos HTTP (rode `curl -sI https://www.sistemavargas.com.br` — o resultado tem
   que bater com a tabela da seção A). **Já rodei em 13/09/2026: bate exatamente**
   com a tabela — HSTS, nosniff, X-Frame-Options, CSP frame-ancestors,
   referrer-policy, permissions-policy, sem x-powered-by, redirect 308 de HTTP
   e redirect 307 de `/dashboard` para `/login` sem dado nenhum. Só falta
   printar essa saída.
2. Arquivo da matriz de permissões (6 papéis). É
   [`src/lib/auth/permissoes.ts`](../../src/lib/auth/permissoes.ts), linhas
   89–118 (`PERMISSOES_POR_PAPEL`) — bate exatamente com o que a política e o
   pacote de evidências descrevem. Print dessas linhas resolve.
3. Tabela de auditoria com registros reais, com dado sensível tapado. Confirmado
   em 13/09/2026 que `empresa_auditoria` tem linhas reais (RLS ligada na
   tabela). Nenhum dado sensível aparece nas colunas usadas, então nem precisa
   tapar nada — print direto do Table Editor do Supabase em `empresa_auditoria`
   resolve.
4. MFA ligado nas contas do item 3. Continua pendente — depende do item 3.

## 8. Duas correções de conteúdo em relação à tentativa anterior

- [x] **Página de segurança separada, publicada em 05/09/2026:**
      `www.sistemavargas.com.br/seguranca`. Documento próprio, com capa e
      endereço distintos da privacidade, ligado no rodapé do site e referenciado
      pela página de privacidade (e ela por ele). Cobre os dez tópicos que a
      TikTok pediu — controle de acesso, credenciais, segregação entre empresas,
      criptografia, backups, logs, vulnerabilidades, incidentes, acesso
      administrativo e fornecedores — mais os compromissos sobre dado de
      plataforma, e traz um resumo em inglês para o revisor.

      **Na resposta ao questionário, dê esta URL E anexe o PDF assinado.** Não
      responda com o link da privacidade: são documentos diferentes, e foi isso
      que o revisor apontou.

      Duas coisas na página dependem de você antes do envio: ela publica
      `security@sistemavargas.com.br` como canal de relato (item 5 abaixo — o
      endereço ainda não existe), e declara o MFA como "em implantação", porque
      o item 3 continua aberto. As duas afirmações são verdadeiras hoje; a
      primeira vira problema no dia em que um revisor escrever para lá.
- [ ] **A resposta anterior dizia Google Cloud Platform.** Não é. O pacote de
      evidências corrige isso abertamente na seção B8 — mantenha a correção. Um
      revisor que encontra uma inexatidão sozinho passa a duvidar de todo o resto.
- [ ] Responda tudo **em inglês**. Uma das respostas anteriores estava em
      português, e as instruções pedem inglês.

---

## Depois do envio (não bloqueia)

- Guarda de permissão nas 70 rotas de API que ainda não têm (33 de 103 têm hoje).
- Content-Security-Policy completa, primeiro em modo `report-only`.
- Fechar a leitura anônima do catálogo e dos clientes — depende de o PDV externo
  passar a autenticar via `autenticar_operador_pdv()`. É o único item que exige
  mudança fora deste repositório. Reconfirmado em 13/09/2026 pelo advisor do
  Supabase: 97 tabelas sem RLS, `clientes` (103 linhas) entre elas. A política
  e o pacote de evidências não afirmam RLS nessa tabela — só nas de
  credenciais, pedidos, anúncios, preços e auditoria — então isso não é uma
  inexatidão no que já foi enviado, é o mesmo item de sempre.
- Tirar o `senha_hash` do alcance do anônimo (bloco separado no fim do SQL do
  item 1, para rodar com a loja fechada, depois do PDV externo atualizado).

## Depois da aprovação de segurança (15/09/2026)

Faltam duas avaliações antes de "Publicar" ficar disponível, nenhuma delas
sobre segurança:

- **Avaliação de anúncios** — quase pronta (imagens 5:3 e descrição de 200+
  caracteres resolvidas em 15/09/2026).
- **Avaliação de aplicativo** — exigia integração de verdade. Construída em
  15/09/2026: OAuth de vendedor + importação de catálogo
  (`src/lib/tiktok/`, rotas `src/app/api/marketplace/tiktok/*`), seguindo o
  mesmo padrão de Shopee/Mercado Livre/Nuvemshop. Falta testar ao vivo (ver
  item de segurança abaixo antes de conectar uma loja de verdade).

**⛔ Achado de segurança em 15/09/2026, antes de testar:** a mesma app key da
TikTok (`6k63nslih1hqg`) já está em uso num app Electron irmão
(`sistemavargas`/`vargasnexus-pdv`, fora deste repositório), com o **app
secret gravado em texto puro no código-fonte**
(`src/main/tiktok.js`). Mesma classe de risco já registrada no item 2 deste
arquivo para Shopee/Mercado Livre/WhatsApp. **Rotacione o app secret no
Partner Center antes de conectar qualquer loja de verdade** — sem isso, o
segredo em uso na integração nova é o mesmo que já está exposto em outro
lugar. Depois de rotacionado, o valor novo entra em Configurações →
Integrações → TikTok Shop, nunca no código.
