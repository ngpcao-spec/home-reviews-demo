# Foursea — consigne courte commune JEV / Luna

Expérience indépendante : `direct4-short-common-comparison-v1`.
Source immuable : `analysis_jls_snapshot_preparations/8e461b23-8b91-4aa2-9d6e-902e8e8ce0e0`.
87 textes anglais exacts, 4 questions par modèle et avis. Le corpus a déjà été examiné ; ce test observe un changement de consigne sur des données connues.

La configuration `direct4_short_common_1pass_v1` contient uniquement les définitions, six choix et consignes métier du message utilisateur. SHA256 : `14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3`.
La vue depuis le restaurant est explicitement dans ambiance, comme demandé. Les anciennes exceptions et exemples ne sont pas importés dans les requêtes.

- JEV : `jev-1.13.0`, System One, questions objet avec critères.
- Luna : `gpt-6-luna`, Decisions, tableau de questions choice.
- Le contenu des instructions et descriptions est identique ; seul le format API change.
- Les états envoyés ne contiennent que review_alias et analysis_text.
- 87 nouvelles requêtes maximum par modèle, aucun Sol/Apify/retry/fallback/modèle de secours.
- Pas de seuil de confiance : choix natifs, probabilités et refus conservés.
- Les modèles effectivement servis sont vérifiés sans requête supplémentaire.

Réutilise process-jls-restaurant, restaurantPort, les réservations atomiques, les intentions d’envoi uniques, les reçus immuables et les RLS d’organisation. Le seul changement du worker commun permet un modèle demandé explicite lié au contrat ; le défaut historique reste inchangé.
La préparation n’autorise aucune dépense. L’autorisation est une opération distincte et traçable liée à la directive courante.
Aucun lancement depuis migration, déploiement ou GET.

Livraison : comparaison appariée de 348 cellules ; tous les désaccords avec textes ; changements de chaque modèle par rapport à son ancien prompt ; comptages natifs et mixtes dédupliqués ; usage/durée par requête ; archive complète.
Accord ≠ justesse ; désaccord ≠ erreur attribuée. Pas d’audit qualitatif ni activation commerciale.

## Qualification avant lancement

Protocole : `c592870c-ee7e-410c-897e-4a9544d3f7da`. SHA256 : `a59dc19e248249a9ef96792316556b160d875cc28fc0d356a929dbb5838bdee3`.
Le test SQL transactionnel effectue 174 réservations / intentions / reçus / finalisations simulés puis annule toutes ses écritures : 87 par phase, pas de Sol, refus des doubles intentions et des appels sans GO. Durée par réservation mesurée : 21,398 à 41,923 ms.
Le rejeu Deno sans réseau utilise les 87 textes figés, 174 requêtes simulées, puis vérifie la comparaison et la sauvegarde ainsi que les réveils répétés et concurrents. Les réponses simulées ne démontrent pas une qualité réelle des modèles.
