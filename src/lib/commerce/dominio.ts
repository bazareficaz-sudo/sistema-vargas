// DOMÍNIO RAIZ DA PLATAFORMA — sozinho, num módulo sem dependência de nada.
//
// Estava em `commerce/loja.ts`. Saiu para cá quando o selo LO da lista de
// produtos passou a montar o endereço da vitrine: `loja.ts` importa
// `next/headers` para descobrir a loja pelo host, e isso é código de
// SERVIDOR. Um componente de cliente que importasse a constante de lá
// arrastaria o módulo inteiro para o bundle do navegador — e o build falha,
// que foi exatamente o que aconteceu.
//
// A constante é `NEXT_PUBLIC_`, então vale nos dois lados. Duplicar o
// `process.env` em cada lugar que precisa seria mais simples de escrever e
// pior de manter: o dia em que a plataforma trocar de domínio, quem esquecer
// uma cópia produz link para um endereço que não existe.

/**
 * Domínio raiz da plataforma. `bazareficaz.dominio.com.br` → `bazareficaz`.
 * Configurável porque o domínio muda entre desenvolvimento, homologação e
 * produção — e porque o dia em que existir um segundo domínio, isto não pode
 * estar espalhado pelo código.
 */
export const DOMINIO_RAIZ = process.env.NEXT_PUBLIC_LOJA_DOMINIO_RAIZ ?? ''
