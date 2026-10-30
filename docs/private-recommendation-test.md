# Écran privé de test des recommandations

Route protégée : `/#/plus/recommandations`, accessible depuis « Plus » en FR/VI.
Le parcours classique décrit ci-dessous reste lecteur. L'option explicite
`action:'compare'` est décrite séparément dans
[private-recommendation-ai-comparison.md](private-recommendation-ai-comparison.md) :
elle seule peut réserver un appel IA et écrire son reçu privé.
Point d’entrée : `test-restaurant-recommendations`, JWT vérifié par la plateforme
puis `requireUser` / `auth.getUser`. Les comptes anonymes sont refusés. Les rôles
owner/admin/manager sont conservés, conformément aux RLS des publications et fiches.
Aucune nouvelle politique, permission SQL ou migration.

## Contrat et lecture

POST JSON : `{action:'options'|'recommend', organization_id?, cuisine?, maximum_vnd?, service_priority?}`.
Les autres champs et les valeurs invalides sont refusés. Devise VND et unité
par personne sont fixées côté serveur. Aucun corpus, score ou choix de langue
n’est accepté du navigateur. Les critères ne sont pas assouplis automatiquement.

Le serveur découvre les organisations autorisées depuis la session. Sans choix,
la première organisation dans l’ordre stable de ses identifiants est utilisée ;
un sélecteur permet de changer de catalogue si plusieurs organisations sont accessibles.
L’appartenance est revérifiée pour l’organisation choisie. Toutes les requêtes
utilisent le client du compte et ses RLS, sans requête admin ni RPC.
Le lecteur paginé joint fiche et publication durable dans un SELECT et limite
les résultats aux établissements actifs du même catalogue et à la langue du profil.
Les cuisines offertes viennent des fiches admissibles via le moteur lui-même.
Absence de rapport compatible dans cette langue : aucune autre langue empruntée.

`recommendRestaurants` demeure l’unique classement. Le nouveau mode explicite
`{geography:'not_requested'}` n’invente aucune position, ne filtre pas les
coordonnées absentes et renvoie `distance_metres:null`, `distance_kind:'not_requested'`.
Le départage par distance et la marge géographique ne s’appliquent pas dans ce
mode : toutes les localisations du catalogue sont admissibles. Les bandes de
scores, le service, la comparabilité/diversité des prix et le maximum de trois
propositions utilisent la même implémentation. Les requêtes avec position/zone
conservent leur comportement. Aucun affinement « plus proche » sans position.

Les budgets monétaires exigent devise, bornes fermées et unité explicitement
confirmée par les métadonnées Google sauvegardées. Prix et unité inconnus restent
admissibles sans budget. Les fourchettes sont indicatives. Les fiches marquées
uniquement `CORPUS_CHANGED` conservent leur rapport daté et ses scores figés.

## Interface et sûreté

Un clic sans formulaire suffit. Cuisine, budget et service sont facultatifs.
L’ordre reçu du moteur est conservé ; aucun tri ni reclassement dans le client.
Deux raisons déterministes utilisent les codes du moteur et les citations du
rapport. Aucune nouvelle reformulation IA. Les extraits longs sont limités
visuellement ; leur texte intégral reste disponible dans « Détails ».
La première réserve du rapport est affichée si disponible. La date, le corpus,
la source du prix et la fraîcheur sont conservés. Un changement de compte,
d’organisation, de langue ou de filtres invalide une réponse client en retard.
Les résultats ne sont pas persistés côté navigateur ; réponses HTTP `private, no-store`.

Le parcours n’importe aucun worker de collecte/génération et n’écrit aucune
donnée. Aucune collecte, traduction, analyse, synthèse, réservation de tentative,
génération, nouvelle surveillance ou connexion HOME AI.

## Vérification et livraison

- Tests HTTP avec le vrai helper d’authentification et un transport simulé :
  absence de session, compte anonyme, rôles, organisation étrangère, langue,
  données incohérentes/inactives, budgets, entrées invalides et échecs.
- Tests du moteur avec et sans position ; anciens contrôles de budget et service.
- `npx playwright test --config playwright.recommendation.config.ts` : application,
  page et moteur réels, données et transport simulés, réseau externe bloqué.
  FR/VI, iPhone 390 px et mobile 360 px, menu, connexion, critères, absence de
  résultat, retrait explicite du budget, résultat unique, sources et lien fiche.
- Lint, tests, build et contrôle de types de la fonction dans la CI.

Après intégration du commit, déployer uniquement `test-restaurant-recommendations`
avec `verify_jwt=true` et ses dépendances partagées. La livraison Pages publie
ensuite l’écran. Vérifier séparément la version serveur, les refus sans JWT et
le parcours connecté en lecture seule ; les simulations ne prouvent pas à elles
seules le raccordement de production.

Les données et captures réelles restent hors du dépôt public. Le retour arrière
consiste à retirer l’entrée/page de test et sa fonction ; aucun historique ni
rapport ne doit être restauré ou modifié car ce parcours est uniquement lecteur.
