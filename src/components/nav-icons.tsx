// Ícones de linha simples pros grupos do menu — substituem os emojis.
// Todos 20x20, stroke="currentColor" (herdam a cor do texto/estado ativo).
import type { ReactElement } from 'react'

type IconProps = { className?: string }
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function IconDashboard({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.3" />
      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.3" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.3" />
      <rect x="11" y="11" width="6.5" height="6.5" rx="1.3" />
    </svg>
  )
}

export function IconCart({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M2.5 3h1.8l1.1 9.2a1.6 1.6 0 0 0 1.6 1.4h6.8a1.6 1.6 0 0 0 1.6-1.3l1.1-6.2H5" />
      <circle cx="8" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconFolder({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M2.5 5.3a1.3 1.3 0 0 1 1.3-1.3h3.6l1.6 1.8h6.7a1.3 1.3 0 0 1 1.3 1.3v7.1a1.3 1.3 0 0 1-1.3 1.3H3.8a1.3 1.3 0 0 1-1.3-1.3z" />
    </svg>
  )
}

export function IconBox({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M10 2.5 17 6v8l-7 3.5L3 14V6z" />
      <path d="M3 6l7 3.5L17 6M10 9.5V17.5" />
    </svg>
  )
}

export function IconBag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M5.5 6.5h9l.8 9.5a1.3 1.3 0 0 1-1.3 1.4H6a1.3 1.3 0 0 1-1.3-1.4z" />
      <path d="M7.2 6.5v-1a2.8 2.8 0 0 1 5.6 0v1" />
    </svg>
  )
}

export function IconWallet({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <rect x="2.5" y="5" width="15" height="10.5" rx="1.6" />
      <path d="M2.5 8.3h15" />
      <circle cx="14" cy="11.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconStore({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M3 8.5V16a.8.8 0 0 0 .8.8h12.4a.8.8 0 0 0 .8-.8V8.5" />
      <path d="M2.3 5.5 3.4 3h13.2l1.1 2.5a2 2 0 0 1-3.9.8 2 2 0 0 1-3.9 0 2 2 0 0 1-3.8 0 2 2 0 0 1-3.9-.8z" />
      <path d="M8 16.5v-4.2h4v4.2" />
    </svg>
  )
}

export function IconChat({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M3 4.5h14a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H8l-3.5 3v-3H3a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z" />
    </svg>
  )
}

export function IconChart({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M3 17V8M9 17V3M15 17v-6" />
      <path d="M2.5 17h15" />
    </svg>
  )
}

export function IconGear({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.9 5.1l-1.1 1.1M6.2 13.7l-1.1 1.1M14.9 14.9l-1.1-1.1M6.2 6.2 5.1 5.1" />
    </svg>
  )
}

export function IconBolt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" stroke="none">
      <path d="M11.2 2 4 11.5h4.4L8 18l7.6-9.8h-4.6z" />
    </svg>
  )
}

export function IconSearch({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="8.8" cy="8.8" r="5.3" />
      <path d="M16.5 16.5l-3.7-3.7" />
    </svg>
  )
}

export function IconStar({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.8l2.2 4.6 5 .7-3.6 3.6.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.6 5-.7z" />
    </svg>
  )
}

export function IconClock({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="10" cy="10" r="7.3" />
      <path d="M10 6v4l2.8 1.8" />
    </svg>
  )
}

export function IconNews({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <rect x="2.5" y="4" width="12" height="12" rx="1.2" />
      <path d="M14.5 7.5H17a.5.5 0 0 1 .5.5v7a1.5 1.5 0 0 1-1.5 1.5h-1" />
      <path d="M5.5 7h6M5.5 9.7h6M5.5 12.4h3.5" />
    </svg>
  )
}

export function IconLogout({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} {...base}>
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" />
      <path d="M12.5 13.5 17 10l-4.5-3.5M17 10H7.5" />
    </svg>
  )
}

export const GROUP_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  dashboard: IconDashboard,
  comercial: IconCart,
  cadastros: IconFolder,
  estoque: IconBox,
  compras: IconBag,
  financeiro: IconWallet,
  marketplaces: IconStore,
  crm: IconChat,
  relatorios: IconChart,
  gestao: IconGear,
  automacoes: IconBolt,
}
