// Layout sem sidebar — PDV ocupa tela cheia
export default function PDVLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden">{children}</div>
}
