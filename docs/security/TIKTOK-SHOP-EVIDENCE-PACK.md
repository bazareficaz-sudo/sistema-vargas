# Security Questionnaire — Evidence Pack

**Applicant:** [LEGAL ENTITY NAME]
**Application:** Sistema Vargas — ERP / point-of-sale integration for TikTok Shop sellers
**Contact:** [NAME], [EMAIL], [PHONE]
**Date:** [DATE]

The previous submission was declined for *"lack of evidence of policy
documentation."* This pack answers that directly: for every control claimed, it
names **where the evidence is** and, wherever possible, **how the reviewer can
verify it without our help**.

**Attachment:** `Information Security Policy v1.0`, signed and dated.

---

## A. How to verify the technical controls yourself

These require no cooperation from us. Run them against `https://www.sistemavargas.com.br`.

| # | Claim | How to verify | Expected result |
|---|---|---|---|
| A1 | All traffic is HTTPS with HSTS | `curl -sI https://www.sistemavargas.com.br` | `strict-transport-security: max-age=31536000; includeSubDomains` |
| A2 | MIME-type sniffing disabled | same response | `x-content-type-options: nosniff` |
| A3 | Clickjacking protection | same response | `x-frame-options: SAMEORIGIN` and `content-security-policy: frame-ancestors 'self'` |
| A4 | Internal URLs not leaked to third parties | same response | `referrer-policy: strict-origin-when-cross-origin` |
| A5 | Device APIs denied by default | same response | `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()` |
| A6 | Server technology not advertised | same response | no `x-powered-by` header |
| A7 | Plaintext HTTP is not served | `curl -sI http://www.sistemavargas.com.br` | 307/308 redirect to `https://` |
| A8 | TLS version and cipher suite | SSL Labs test on the domain | TLS 1.2 minimum; TLS 1.0/1.1 not offered |
| A9 | Authenticated areas are not publicly reachable | `curl -sI https://www.sistemavargas.com.br/dashboard` | redirect to `/login` — no data returned |

## B. Answers to the questionnaire domains

Each answer states what is in place. Section references point into the attached
Information Security Policy.

### B1. Do you have a documented information security policy?

**Yes.** Information Security Policy v1.0, attached, adopted and signed by
[NAME], [TITLE], on [DATE]. It is reviewed annually and after any Severity 1
incident (Policy §17).

*Note on the previous submission: the URL supplied was our privacy notice, which
is a different document. The security policy is the attachment to this pack.*

### B2. Access control — is access restricted on a least-privilege basis?

**Yes.** (Policy §4.)

- Six fixed roles with a fixed permission matrix defined in one source file;
  the matrix cannot be edited from the user interface.
- Every privileged request is authorized **on the server**. Hiding a button is
  never treated as an access control.
- Every record is scoped to the owning company; queries are filtered by the
  authenticated user's company, so one seller can never read another's data.
- Row Level Security is enforced **in the database** on the tables holding
  integration credentials, order history, listing data, pricing rules, and audit
  records — so an application-layer mistake alone cannot expose them.
- The database key that bypasses authorization is server-side only and is never
  present in the browser bundle.
- Multi-factor authentication is required on every administrative account
  (hosting, database, source repository, domain registrar, and each commerce
  platform developer console).
- Access is reviewed quarterly and revoked the day an engagement ends.

*Evidence available on request: a screenshot of the permission matrix source
file, and a demonstration that a request from an unauthenticated client to a
protected table returns zero rows.*

### B3. Is data encrypted in transit and at rest?

**Yes.** (Policy §6.) In transit: TLS 1.2 minimum, HSTS enforced — verifiable via
A1 and A8 above. At rest: provider-managed AES-256 disk encryption on the managed
database and object storage, including backups.

### B4. How are API credentials and tokens protected?

(Policy §6, §3.) Platform credentials and OAuth tokens are held as environment
variables in the hosting provider's encrypted configuration store, never in source
control (the repository ignores `.env*` by configuration), and never written to
logs. Access tokens are stored in a database table that is unreadable without a
privileged server-side key and is protected by Row Level Security.

On suspected exposure, credentials are assessed by the harm an attacker could
cause with that specific key (Policy §11). Credentials able to produce legally
binding documents in our name are rotated unconditionally. For the rest, the
decision and its reasoning are recorded by the Information Security Officer.

*Disclosed in full: an internal review on 2 August 2026 found that a
configuration table holding integration credentials had been readable without
authentication. Access to that table was closed the same day and verified. The
fiscal issuance token was rotated. Three marketplace and messaging credentials
were retained after assessment, on the basis that their worst case is commercial
and that the exposure path is now closed. **No TikTok Shop credential was
involved — this integration does not yet exist.** We report this because a
partner is entitled to know how we behaved when it was inconvenient, and because
the alternative was to claim a control we had not applied.*

### B5. Do you log and monitor access to data?

**Yes.** (Policy §9.) Privileged actions — user invitation, role change, account
block, support access to a customer account, fiscal document issuance, order
stage changes — are written to an immutable audit table capturing actor, action,
affected record, previous value, new value, and timestamp. Stock movements are an
append-only ledger; corrections are compensating entries, never edits or
deletions. Audit records are retained for at least 12 months.

### B6. Do you have an incident response process?

**Yes.** (Policy §11.) Named contact, defined severity handling, and committed
timelines: containment within 4 hours of confirmation, impact assessment within
24 hours, **notification to the affected commerce platform within 24 hours** of
confirming that platform data or credentials are involved, ANPD/data-subject
notification within the statutory LGPD deadline, and a written post-incident
review within 10 business days.

**Security contact for TikTok Shop:** [NAME] — [security@DOMAIN] — [PHONE],
monitored during business hours [TIMEZONE], with out-of-hours escalation to the
same number.

### B7. Secure development practices?

(Policy §8.) Private repository, access limited to named individuals with MFA.
Deployment through a build pipeline that refuses to ship code failing
type-checking or compilation. Secrets never committed. Dependencies pinned by
lockfile, advisories reviewed monthly, with remediation targets of 7 days
(critical), 30 (high), 90 (medium) — Policy §10. Schema changes applied as
reviewed, version-controlled migration scripts.

### B8. Network security?

(Policy §7.) No self-managed servers, no open SSH, no publicly exposed admin
console. The application runs on a managed serverless platform; the database is a
managed PostgreSQL service reachable only over TLS. DDoS protection, TLS
termination, and edge filtering are provided by the hosting platform.

*Correction to the previous submission: the earlier response named Google Cloud
Platform. That was inaccurate. The application is hosted on a managed serverless
platform and the database on a managed PostgreSQL service running on AWS
infrastructure. We would rather correct the record than have a reviewer discover
the discrepancy.*

### B9. Business continuity and backup?

(Policy §12.) Automated backups by the managed database provider with
point-in-time recovery on our subscription tier; restore tested at least
annually; RPO 24 hours, RTO 24 hours. Point-of-sale terminals run against a local
database and keep selling through a connectivity outage, synchronizing on
reconnection.

### B10. Third-party processors?

(Policy §13.) The full list, with purpose and data category, is in the policy.
No customer personal data is sent to a processor that has not been assessed for
encryption, access control, and incident notification.

### B11. Data retention and deletion?

(Policy §14.) TikTok Shop data is retained only as long as needed to fulfil the
seller's orders and meet Brazilian legal record-keeping obligations. **On
termination, or on TikTok Shop's request, credentials are revoked and deleted and
the data received is deleted within 30 days**, except records we are legally
required to retain, which are isolated from further processing.

### B12. Use of platform data?

(Policy §16.) TikTok Shop data is used **only** to provide the seller with order
fulfilment, stock, and accounting functions inside that seller's own account. It
is never sold, rented, licensed, or shared beyond the listed processors; never
used for advertising, audience building, or training machine-learning models; and
never commingled between sellers. We request the minimum API scopes the features
require.

### B13. Personnel and endpoint security?

(Policy §15.) Full-disk encryption, screen lock, and current OS security updates
on every device with production access. Credentials in a password manager, never
in plaintext files or messages. Security briefing on engagement and annually.

---

## C. What we are still building

We would rather state this than have it found.

| Item | Current state | Committed by |
|---|---|---|
| Server-side permission guard on every API route | Enforced on the privileged routes; the remainder are being retrofitted route by route | [DATE — suggest 90 days] |
| Content-Security-Policy beyond `frame-ancestors` | Not yet set; will be deployed in report-only mode first so it is measured before it blocks | [DATE — suggest 90 days] |
| Formal penetration test by an external firm | Not yet performed | [DATE, or "on request as a condition of approval"] |
| SOC 2 / ISO 27001 certification | Not held; we are a small Brazilian company and this is not currently proportionate | — |

We are not claiming certifications we do not hold. Everything in section B is in
place and, where marked, independently verifiable today.

---

## D. Attachments

1. `Information Security Policy v1.0` — signed and dated (PDF).
2. Screenshot: HTTP response headers from `https://www.sistemavargas.com.br` (matches section A).
3. Screenshot: permission matrix source file (six roles × permissions).
4. Screenshot: audit log table with sample entries, sensitive values redacted.
5. Screenshot: MFA enabled on hosting, database, and repository accounts.
