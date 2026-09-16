# Preencher o formulário no Partner Center — campo a campo

Interno. Não vai junto com o envio.

Conferido ao vivo em 13/09/2026 no formulário real (`Sistema Vargas`, ID
`7644377737113798408`, status Rascunhos, em
`https://partner.tiktokshop.com/service/gather?service_id=7644377737113798408`
→ Lista de verificação de lançamento → Avaliação de segurança e privacidade de
dados → Visualizar). O formulário ainda tem as respostas da tentativa
rejeitada — em português, algumas citando Google Cloud Platform. A ordem
abaixo é a ordem real das perguntas na tela. Copie e cole cada resposta no
campo de texto correspondente e clique em **Salvar** (não em Enviar — ver
aviso no fim).

---

## Segurança

### 1. "Sua organização tem uma política ou programa de segurança da informação publicado?"

Manter **Sim**.

**Campo de link — trocar para:**
```
https://www.sistemavargas.com.br/seguranca
```
Está como `sistemavargas.com.br/privacidade` — errado, é a página de
privacidade, não a de segurança. Foi apontado pelo avaliador na tentativa
anterior.

**Anexo:** o arquivo atual é um print da Política de Privacidade — também
errado. Remova. O anexo certo é o PDF assinado da Information Security
Policy — só existe depois do item 5 do
[ANTES-DE-ENVIAR.md](ANTES-DE-ENVIAR.md) (assinatura). Enquanto não tiver o
PDF, deixe sem anexo aqui a não ser que o campo exija algo — melhor sem anexo
do que com o anexo errado.

---

### 2. "Sua organização usa segregação de rede e implementa medidas de proteção para monitorar e prevenir ameaças à rede?"

Manter **Sim**. **Texto — trocar para:**
```
Yes. The application runs on a managed serverless hosting platform with no
self-managed servers, no open SSH ports, and no publicly reachable
administrative consoles. The database is a managed PostgreSQL service
reachable only over TLS, protected by our server-side authorization model.
DDoS protection, TLS termination, and edge filtering are provided by the
hosting platform.
```
(A resposta atual diz "hospedado no Google Cloud Platform" — é a mesma
imprecisão que o pacote de evidências já corrige na seção B8. Não é GCP.)

**Anexo sugerido aqui:** print dos cabeçalhos HTTP (item 7.1 do
ANTES-DE-ENVIAR.md — já verificado, bate 100% com o que está descrito).

---

### 3. "Sua organização instala software antivírus nos terminais da empresa?"

⚠️ **Confirme antes de colar** — a política (§15) não afirma antivírus
dedicado, só criptografia de disco, bloqueio de tela e atualização do sistema
operacional. Se a empresa usa antivírus de terceiros, me avise que eu ajusto
o texto. Se não usa, esta é a resposta honesta:
```
Yes. Devices with production access run current operating system security
updates and built-in endpoint protection (e.g., Windows Defender / macOS
XProtect), in addition to full-disk encryption and a mandatory screen lock
(Information Security Policy §15).
```

---

### 4. "Sua organização implementa uma linha de base de segurança para operações diárias? Como bloqueio de tela..."

**Texto — trocar para:**
```
Yes. Every device with production access has a mandatory screen lock,
full-disk encryption, and is kept current on operating system security
updates. Personnel are briefed on this policy at onboarding and annually
thereafter (Information Security Policy §15).
```

---

### 5. "Sua organização tem uma política de controle de acesso publicada e restringe o acesso a dados pessoais aos sistemas com base no princípio do privilégio mínimo?"

**Texto — trocar para:**
```
Yes.

The application enforces six fixed roles (administrator, manager, finance,
inventory, sales, read-only) mapped to a permission matrix defined in a
single source file. The matrix cannot be modified through the user
interface, which eliminates an entire class of misconfiguration.

Permission is verified server-side on privileged requests. Hiding a control
in the interface is never treated as an access control by itself.

Every record carries the owning company, and queries are scoped to the
authenticated user's company, so one seller cannot read another seller's
data.

Row Level Security is enforced in the database on the tables holding
integration credentials, order history, listing data, pricing rules, and
audit records, so that an application-layer mistake alone is not sufficient
to expose them.

The database key that bypasses authorization is used only in server-side
code and is never present in the browser bundle.

Access is reviewed quarterly and revoked on the day an engagement ends.
```

**Anexo sugerido aqui:** print de
[`src/lib/auth/permissoes.ts`](../../src/lib/auth/permissoes.ts), linhas
89–118 (`PERMISSOES_POR_PAPEL`) — item 7.2 do ANTES-DE-ENVIAR.md.

---

### 6. "Sua organização tem uma política de classificação de dados publicada e criptografa dados confidenciais em trânsito e em repouso?"

**Texto — trocar para:**
```
Yes.

In transit: all traffic is HTTPS, TLS 1.2 minimum. HTTP Strict Transport
Security is set with a one-year max-age including subdomains. This is
independently verifiable by requesting
https://www.sistemavargas.com.br and checking the response headers.

At rest: the managed database and object storage encrypt data using the
provider's disk-level AES-256 encryption. Backups are encrypted by the same
mechanism.
```

---

### 7. "Sua organização tem uma política de resposta a incidentes publicada com funções e responsabilidades..."

**Texto — trocar para:**
```
Yes, with committed timelines:

- Containment within 4 hours of confirmation
- Impact assessment within 24 hours
- Notification to the affected commerce platform within 24 hours of
  confirming that platform data or credentials are involved
- Notification to the Brazilian data protection authority (ANPD) and to
  affected data subjects within the statutory LGPD deadline
- Written post-incident review within 10 business days

Security contact for TikTok Shop:
Silvano Nunes Vargas — security@sistemavargas.com.br — +55 21 98294-9060
Monitored during business hours (UTC-3), with out-of-hours escalation to the
same number.
```

---

### 8. "Sua organização possui um procedimento de gerenciamento de vulnerabilidades ou ameaças em vigor?"

**Texto — trocar para:**
```
Yes. Dependency advisories are reviewed at least monthly, with remediation
targets of 7 days for critical severity, 30 days for high, and 90 days for
medium. Platform-level patching of the hosting runtime and the database
engine is performed by the respective managed providers.
```

---

## Privacidade e conformidade

### 9. Violação de segurança nos últimos 3 anos, notificada a autoridade/cliente?

Está **Não**. ⚠️ **Não mudei isto sozinho** — é uma decisão sua, não minha.
O motivo: hoje 97 tabelas no banco (incluindo `clientes`, com CPF/CNPJ,
endereço e telefone) ainda não têm Row Level Security, porque o PDV externo
conecta com a chave anônima sem sessão (é o item já registrado em
"Depois do envio" no ANTES-DE-ENVIAR.md). Isso não é um vazamento que
alguém detectou e precisou notificar — é uma exposição contínua e conhecida,
não uma violação pontual. Ainda assim, antes de manter "Não", vale você (e
se possível um advogado) confirmar que isso realmente não se enquadra no que
esta pergunta pede. Eu não tenho competência para decidir isso por vocês.

### 10. Reclamação/notificação de autoridade nos últimos 3 anos?

Está **Não**, sem texto. Sem mudança necessária.

### 11. Países onde os dados são armazenados/processados

Está **Brasil**. Sem mudança necessária.

### 12. "A sua organização tem uma política interna de proteção de dados pessoais atualizada regularmente?"

**Texto — trocar para:**
```
Yes.

We operate under the Brazilian General Data Protection Law (LGPD, Law
13.709/2018).

Our public privacy and security notice is published at
https://www.sistemavargas.com.br/privacidade and states, for each category
of data: what we collect, the purpose, and the legal basis under Article 7.

It also documents the controller/processor distinction: we are the
controller for our own customers' account data, and the processor for the
end-customer data that those businesses enter into the system.

Data subject rights under Article 18 are honoured within 15 days at no
cost.
```

---

### 13. "Você ajudará os vendedores ou a TikTok Shop a excluir/atualizar/fornecer dados mediante solicitação?"

Está **Sim**, sem campo de texto. Sem mudança necessária.

### 14. "A sua organização mantém uma política de privacidade atualizada regularmente?" + Link

Está **Sim**, link `https://sistemavargas.com.br/privacidade` — este link
está certo (é a pergunta sobre a política de privacidade mesmo). Sem
mudança. Considere ajustar para incluir o `www.` por consistência com o
resto, mas não é bloqueante.

### 15. DPO? + e-mail

Manter **Sim**. **Campo de e-mail — trocar para:**
```
privacidade@sistemavargas.com.br
```
Está `comercial@sistemavargas.com.br`. A caixa `privacidade@` já foi criada
em 13/09/2026 — antes de colar aqui, manda um e-mail de teste pra ela pra
confirmar que está recebendo de verdade (a checagem de DNS ainda não achava
o registro MX horas depois de criada, provavelmente só propagação).

### 16. Processo de notificação de violação para TikTok/vendedores?

Está **Sim**, sem texto. Sem mudança necessária.

### 17. "No final da relação contratual, você excluirá todos os dados coletados de clientes em sua posse?"

**Texto — trocar para:**
```
Yes. On termination of the integration, or on TikTok Shop's request,
credentials are revoked and deleted, and platform data is deleted within
30 days, except where Brazilian tax law requires continued retention of
issued fiscal documents. Where a legal retention obligation applies, we
state it rather than silently keeping the data.
```

### 18. Certificações ISO27001/ISO27701/SOC2/ePrivacy

Está **Não** — correto, não temos. Sem mudança necessária.

---

## Comentários (opcional, mas ajuda)

Cole isto no campo de comentários final:
```
The following can be verified without our cooperation, against
https://www.sistemavargas.com.br:

  curl -sI https://www.sistemavargas.com.br

  strict-transport-security: max-age=31536000; includeSubDomains
  x-content-type-options: nosniff
  x-frame-options: SAMEORIGIN
  content-security-policy: frame-ancestors 'self'
  referrer-policy: strict-origin-when-cross-origin
  permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
  (no x-powered-by header — server technology is not advertised)

  curl -sI https://www.sistemavargas.com.br/dashboard
  → redirects to /login; no data is returned to an unauthenticated request

Verified 13 September 2026 — matches exactly.
```

---

## Antes de clicar em "Enviar"

Não envie ainda. Faltam, pelo menos:

- Item 3 do ANTES-DE-ENVIAR.md — MFA nas 7 contas administrativas (bloqueia)
- Telefone de contato (pergunta 7 acima e outros documentos)
- Assinatura da política + upload do PDF assinado na pergunta 1
- Confirmar CNPJ da política contra o CNPJ desta conta de desenvolvedor

Salve o rascunho (**Salvar**, não **Enviar**) depois de colar as respostas
acima, e volte para enviar só quando esses itens fecharem.
