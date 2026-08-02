# Respostas do questionário — copiar e colar

Cada bloco abaixo é uma resposta pronta, em inglês. Preencha só o que está entre
colchetes. Não traduza: as instruções da TikTok Shop pedem inglês, e uma das
respostas anteriores foi enviada em português.

**Antes de colar qualquer coisa:** anexe o PDF da política assinada. Sem o anexo,
metade destas respostas fica sem lastro — foi por isso que a primeira tentativa
caiu.

Os campos entre colchetes são sempre os mesmos quatro:

- `Ouro e Prata Elétrica` — razão social
- `Silvano Nunes Vargas` / `Owner` — quem assina como responsável pela segurança
- `2 August 2026` — data de adoção da política (a mesma que estiver assinada)
- `[PHONE]` — telefone do contato de segurança

O e-mail já está preenchido: `security@sistemavargas.com.br`. Crie a caixa antes
de enviar — se o revisor escrever e voltar, o efeito é pior do que não ter posto.

---

## 1. Do you have a documented information security policy?

```
Yes. Ouro e Prata Elétrica maintains a documented Information Security Policy
(version 1.0), adopted and signed by Silvano Nunes Vargas, Owner, on 2 August 2026. The policy is
attached to this submission. It is reviewed annually and after any Severity 1
incident.

Note regarding our previous submission: the URL we supplied was our privacy
notice, which is a different document. The security policy is attached here.
```

---

## 2. Is access to systems and data restricted on a least-privilege basis?

```
Yes.

The application enforces six fixed roles (administrator, manager, finance,
inventory, sales, read-only) mapped to a permission matrix defined in a single
source file. The matrix cannot be modified through the user interface, which
eliminates an entire class of misconfiguration.

Permission is verified server-side on privileged requests. Hiding a control in
the interface is never treated as an access control by itself.

Every record carries the owning company, and queries are scoped to the
authenticated user's company, so one seller cannot read another seller's data.
Cross-company visibility exists only where an administrator has explicitly
created a partnership between two companies under the same account owner, and
never between different customers of the platform.

Row Level Security is enforced in the database on the tables holding integration
credentials, order history, listing data, pricing rules, and audit records, so
that an application-layer mistake alone is not sufficient to expose them.

The database key that bypasses authorization is used only in server-side code
and is never present in the browser bundle.

Access is reviewed quarterly and revoked on the day an engagement ends. Blocking
a user account terminates the session at the next request, not at the next login.
```

---

## 3. Is data encrypted in transit and at rest?

```
Yes.

In transit: all traffic is HTTPS, TLS 1.2 minimum. HTTP Strict Transport
Security is set with a one-year max-age including subdomains. This is
independently verifiable — see the verification section below.

At rest: the managed database and object storage encrypt data using the
provider's disk-level AES-256 encryption. Backups are encrypted by the same
mechanism.
```

---

## 4. How are API credentials and access tokens protected?

```
Platform credentials and OAuth tokens are held as environment variables in the
hosting provider's encrypted configuration store. They are excluded from source
control by repository configuration and are never written to application logs.

Access tokens are stored in a database table that is unreadable without a
privileged server-side key and is protected by Row Level Security.

On suspected exposure, credentials are assessed by the harm an attacker could
cause with that specific key. Credentials able to produce legally binding
documents in our name are rotated unconditionally. For others, the decision and
its reasoning are recorded by the Information Security Officer.

Disclosed proactively: an internal review on 2 August 2026 found that a
configuration table holding integration credentials had been readable without
authentication. Access to that table was closed the same day and verified. The
fiscal document issuance token was rotated. Three marketplace and messaging
credentials were retained after assessment, on the basis that their worst case
is commercial rather than legal and that the exposure path is now closed. No
TikTok Shop credential was involved, as this integration does not yet exist. We
report this because a partner is entitled to know how we behave when it is
inconvenient.
```

---

## 5. Do you log and monitor access to data?

```
Yes.

Privileged actions are written to an immutable audit table capturing actor,
action, affected record, previous value, new value, and timestamp. These include
user invitation, role change, account block, support access to a customer
account, fiscal document issuance, and order stage changes.

Stock movements are an append-only ledger. Corrections are recorded as
compensating entries; rows are never edited or deleted.

Audit records are retained for at least 12 months.
```

---

## 6. Do you have an incident response process?

```
Yes, with committed timelines:

- Containment within 4 hours of confirmation
- Impact assessment within 24 hours
- Notification to the affected commerce platform within 24 hours of confirming
  that platform data or credentials are involved
- Notification to the Brazilian data protection authority (ANPD) and to affected
  data subjects within the statutory LGPD deadline
- Written post-incident review within 10 business days

Security contact for TikTok Shop:
Silvano Nunes Vargas — security@sistemavargas.com.br — [PHONE]
Monitored during business hours (UTC-3), with out-of-hours escalation to the
same number.
```

---

## 7. Describe your secure development practices.

```
Source code is held in a private repository with access limited to named
individuals.

Deployment runs through a build pipeline that refuses to ship code failing type
checking or compilation.

Secrets are never committed; the repository ignores environment files by
configuration.

Dependencies are pinned by lockfile. Advisories are reviewed monthly, with
remediation targets of 7 days for critical, 30 days for high, and 90 days for
medium severity.

Database schema changes are applied as reviewed, version-controlled migration
scripts.
```

---

## 8. Describe your network security.

```
There are no self-managed servers, no open SSH ports, and no publicly reachable
administrative consoles under our operation.

The application runs on a managed serverless hosting platform. The database is a
managed PostgreSQL service reachable only over TLS, protected by the
authorization model described above — including for requests presenting the
public client key, which carries no privileges beyond what policy explicitly
grants.

DDoS protection, TLS termination, and edge filtering are provided by the hosting
platform.

Correction to our previous submission: the earlier response named Google Cloud
Platform. That was inaccurate. The application is hosted on a managed serverless
platform and the database on a managed PostgreSQL service running on AWS
infrastructure. We would rather correct the record than have a reviewer discover
the discrepancy.
```

---

## 9. Business continuity and backup?

```
The managed database provider performs automated backups, with point-in-time
recovery on our subscription tier. Restore is tested at least annually. Recovery
point objective: 24 hours. Recovery time objective: 24 hours.

Point-of-sale terminals run against a local database and continue selling
through a connectivity outage, synchronizing on reconnection.
```

> ⚠️ **Confira antes de colar.** Esta resposta depende do plano contratado do
> banco de dados. Se o seu plano não tem recuperação a um ponto no tempo, corte
> essa parte da frase — e corrija também a §12 da política.

---

## 10. Third-party processors?

```
Our processors are listed in the attached policy with purpose and data category.
They cover fiscal document issuance, marketplace integrations, messaging,
payment processing for our own subscription, and cloud infrastructure.

No customer personal data is sent to a processor that has not been assessed for
encryption, access control, and incident notification.
```

---

## 11. Data retention and deletion?

```
TikTok Shop data is retained only as long as needed to fulfil the seller's
orders and to meet Brazilian legal record-keeping obligations.

On termination of the integration, or on TikTok Shop's request, credentials are
revoked and deleted, and platform data is deleted except where Brazilian tax law
requires continued retention of issued fiscal documents. Where a legal retention
obligation applies, we state it rather than silently keeping the data.
```

---

## 12. How do you comply with applicable data protection law?

```
We operate under the Brazilian General Data Protection Law (LGPD, Law
13.709/2018).

Our public privacy and security notice is published at
https://www.sistemavargas.com.br/privacidade and states, for each category of
data: what we collect, the purpose, and the legal basis under Article 7.

It also documents the controller/processor distinction: we are the controller
for our own customers' account data, and the processor for the end-customer data
that those businesses enter into the system.

Data subject rights under Article 18 are honoured within 15 days at no cost. A
data protection officer is designated under Article 41, reachable at
privacidade@sistemavargas.com.br.
```

---

## Verificação que o avaliador faz sozinho

Cole isto como observação final. É o que diferencia de uma lista de promessas —
ele confere em trinta segundos, sem depender de você.

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

An SSL Labs test on the domain confirms TLS 1.2 minimum, with TLS 1.0 and 1.1
not offered.
```

---

## Anexos do envio

1. Política de Segurança da Informação v1.0, assinada e datada (PDF)
2. Print dos cabeçalhos HTTP (tem que bater com a lista acima)
3. Print do arquivo da matriz de permissões (os seis perfis)
4. Print da tabela de auditoria com registros reais, com dado sensível tapado
5. Print de MFA ligado nas contas administrativas

O anexo 5 ainda não existe — o MFA está na lista do
[ANTES-DE-ENVIAR.md](ANTES-DE-ENVIAR.md). Ou você liga antes de enviar, ou tira
o anexo da lista e ajusta a §4 da política. Não vale prometer o print e não
mandar.
