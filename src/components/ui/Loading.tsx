export function CardSkeleton({ count = 3 }: { count?: number }) {
  return <div className="skeleton-list" aria-label="Chargement">{Array.from({ length: count }, (_, i) => <div className="skeleton-card" key={i}><div /><span /><span /></div>)}</div>
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{body}</p>{action}</div>
}
