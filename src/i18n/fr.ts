export interface Messages {
  nav: { home: string; establishments: string; reviews: string; analytics: string; more: string }
  common: { retry: string; cancel: string; confirm: string; loading: string }
}

export const fr: Messages = {
  nav: { home: 'Accueil', establishments: 'Établissements', reviews: 'Avis', analytics: 'Analyses', more: 'Plus' },
  common: { retry: 'Réessayer', cancel: 'Annuler', confirm: 'Confirmer', loading: 'Chargement…' },
}
