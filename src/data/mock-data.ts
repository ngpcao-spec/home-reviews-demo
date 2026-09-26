import type { AppNotification, Establishment, PlanEntitlement, Review, ReviewAnalysis } from '../types/domain'

const now = Date.now()
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString()

export const demoOrganizationId = '00000000-0000-4000-8000-000000000001'

export const demoPlan: PlanEntitlement = { planKey: 'pro', maxEstablishments: 5, syncIntervalMinutes: 60, maxAiResponsesMonth: 250, maxMembers: 5 }

export const seedEstablishments: Establishment[] = [
  { id: 'est-1', organizationId: demoOrganizationId, name: 'Le Petit Hanoi', address: '12 rue de la Paix', city: 'Hanoï', category: 'Cuisine vietnamienne', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Le+Petit+Hanoi+Paris', photoUrl: '/restaurants/hanoi.png', currentRating: 4.2, currentReviewCount: 318, isActive: true, syncEnabled: true, lastSyncedAt: ago(.4), syncStatus: 'ok' },
  { id: 'est-2', organizationId: demoOrganizationId, name: 'Saigon Bistro', address: '8 avenue Parmentier', city: 'Ho Chi Minh-Ville', category: 'Bistrot vietnamien', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Saigon+Bistro+Paris', photoUrl: '/restaurants/saigon.png', currentRating: 4.5, currentReviewCount: 186, isActive: true, syncEnabled: true, lastSyncedAt: ago(.8), syncStatus: 'ok' },
  { id: 'est-3', organizationId: demoOrganizationId, name: 'Da Nang Beach', address: '27 quai de Loire', city: 'Da Nang', category: 'Fruits de mer', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Da+Nang+Beach+Paris', photoUrl: '/restaurants/danang.png', currentRating: 3.9, currentReviewCount: 247, isActive: true, syncEnabled: true, lastSyncedAt: ago(1.2), syncStatus: 'warning' },
  { id: 'est-4', organizationId: demoOrganizationId, name: "L'Indochine", address: '4 place des Vosges', city: 'Paris', category: 'Cuisine fusion', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Indochine+Paris', photoUrl: '/restaurants/hanoi.png', currentRating: 4.7, currentReviewCount: 412, isActive: true, syncEnabled: true, lastSyncedAt: ago(.25), syncStatus: 'ok' },
]

const analyses: Record<string, ReviewAnalysis> = {
  wait: { requiresAction: true, sentiment: 'negative', primaryCategory: 'waiting_time', secondaryCategories: ['service'], urgency: 'high', summary: "Le client signale un temps d'attente très long avant d'être servi.", keyPoints: ['Attente de plus de 45 minutes', 'Personnel peu disponible'], responseLanguage: 'fr', analysisStatus: 'ok' },
  staff: { requiresAction: true, sentiment: 'negative', primaryCategory: 'staff', secondaryCategories: ['service'], urgency: 'critical', summary: 'Le client rapporte un échange très désagréable avec un membre du personnel.', keyPoints: ['Ton jugé agressif', 'Incident signalé devant les autres clients'], responseLanguage: 'fr', analysisStatus: 'ok' },
  clean: { requiresAction: true, sentiment: 'negative', primaryCategory: 'cleanliness', secondaryCategories: [], urgency: 'high', summary: "Le client remet en cause la propreté de la salle et des sanitaires.", keyPoints: ['Table non nettoyée', 'Sanitaires signalés comme sales'], responseLanguage: 'fr', analysisStatus: 'ok' },
  price: { requiresAction: true, sentiment: 'negative', primaryCategory: 'price', secondaryCategories: ['billing'], urgency: 'medium', summary: 'Le client juge le prix élevé et conteste un élément de la facture.', keyPoints: ['Rapport qualité-prix décevant', 'Supplément inattendu'], responseLanguage: 'fr', analysisStatus: 'ok' },
  mixed: { requiresAction: true, sentiment: 'neutral', primaryCategory: 'waiting_time', secondaryCategories: ['product_quality'], urgency: 'medium', summary: "La cuisine est appréciée, mais l'attente a fortement dégradé l'expérience.", keyPoints: ['Plats appréciés', 'Service trop lent'], responseLanguage: 'fr', analysisStatus: 'ok' },
  none: { requiresAction: false, sentiment: 'neutral', primaryCategory: 'other', secondaryCategories: [], urgency: 'low', summary: "Avis mitigé sans plainte précise nécessitant une action.", keyPoints: ['Expérience correcte dans l’ensemble'], responseLanguage: 'fr', analysisStatus: 'ok' },
}

const reviewSeeds = [
  ['r1','est-1','Camille D.',2,"45 minutes d'attente avant de pouvoir commander. Personne ne nous a prévenus et le personnel semblait débordé.",2,'to_process','wait'],
  ['r2','est-2','Minh T.',1,"Un serveur nous a parlé de façon agressive devant toute la salle. Une expérience vraiment pénible.",5,'to_process','staff'],
  ['r3','est-3','Sophie L.',2,"La table collait et les sanitaires n'étaient pas propres. Dommage car l'emplacement est agréable.",9,'to_process','clean'],
  ['r4','est-1','Julien R.',2,"Beaucoup trop cher pour les portions, et un supplément est apparu sur l'addition sans explication.",18,'to_process','price'],
  ['r5','est-4','Anna P.',3,"Les plats étaient très bons mais nous avons attendu presque une heure. Je ne sais pas si je reviendrai.",27,'to_process','mixed'],
  ['r6','est-3','Thomas V.',3,"Correct dans l'ensemble, sans être mémorable. Le cadre est joli.",40,'ignored','none'],
  ['r7','est-2','Léa M.',5,"Excellent accueil et pho délicieux. Nous reviendrons !",52,'ignored',null],
  ['r8','est-4','Olivier N.',4,"Très bonne adresse, service souriant et assiettes généreuses.",64,'ignored',null],
  ['r9','est-1','Marie K.',5,"Une vraie découverte, tout était parfaitement assaisonné.",78,'ignored',null],
  ['r10','est-3','Noah B.',4,"Belle terrasse et cocktails réussis.",92,'ignored',null],
  ['r11','est-2','Élodie S.',2,"Commande oubliée puis servie froide. L'équipe s'est excusée mais la soirée était gâchée.",118,'processed','service'],
  ['r12','est-4','Hugo C.',1,"Réservation introuvable à notre arrivée et aucune solution proposée.",150,'processed','staff'],
  ['r13','est-1','Mai L.',3,"Bon repas mais deux plats de la carte n'étaient plus disponibles.",176,'ignored','none'],
  ['r14','est-3','Clara E.',5,"Parfait pour un dîner entre amis.",210,'ignored',null],
  ['r15','est-2','Paul A.',4,"Service rapide ce midi, formule intéressante.",242,'ignored',null],
  ['r16','est-4','Emma G.',5,"Cuisine subtile et accueil impeccable.",310,'ignored',null],
  ['r17','est-1','Lucas F.',2,"Livraison avec presque une heure de retard et plats tièdes.",340,'processed','wait'],
  ['r18','est-3','Inès J.',3,"Musique un peu forte mais équipe sympathique.",390,'ignored','none'],
  ['r19','est-2','Chloé Z.',5,"Le meilleur bo bun du quartier.",460,'ignored',null],
  ['r20','est-4','Marc H.',4,"Très bien, réservation respectée et service attentionné.",520,'ignored',null],
] as const

export const seedReviews: Review[] = reviewSeeds.map(([id, establishmentId, authorName, rating, reviewText, hours, status, analysisKey]) => ({
  id, organizationId: demoOrganizationId, establishmentId, externalReviewId: `mock-${id}`, authorName, rating,
  reviewText, reviewLanguage: 'fr', publishedAt: ago(hours), sourceUrl: seedEstablishments.find((e) => e.id === establishmentId)!.googleMapsUrl,
  isHistoricalImport: hours > 48, requiresAction: status === 'to_process', status,
  analysis: analysisKey ? analyses[analysisKey] : undefined,
}))

export const seedNotifications: AppNotification[] = [
  { id: 'n1', establishmentId: 'est-1', reviewId: 'r1', type: 'new_negative_review', title: 'Nouvel avis 2★ — Le Petit Hanoi', body: "Le client signale un temps d'attente très long.", severity: 'high', createdAt: ago(2) },
  { id: 'n2', establishmentId: 'est-2', reviewId: 'r2', type: 'new_negative_review', title: 'Avis critique — Saigon Bistro', body: 'Un incident avec le personnel demande votre attention.', severity: 'critical', createdAt: ago(5) },
  { id: 'n3', establishmentId: 'est-3', reviewId: 'r3', type: 'new_negative_review', title: 'Nouvel avis 2★ — Da Nang Beach', body: 'Un problème de propreté a été détecté.', severity: 'high', createdAt: ago(9), readAt: ago(6) },
]

export const ratingTrend = [
  { day: '28 août', rating: 4.08 }, { day: '2 sept.', rating: 4.15 }, { day: '7 sept.', rating: 4.12 },
  { day: '12 sept.', rating: 4.25 }, { day: '17 sept.', rating: 4.2 }, { day: '22 sept.', rating: 4.36 }, { day: '26 sept.', rating: 4.31 },
]
