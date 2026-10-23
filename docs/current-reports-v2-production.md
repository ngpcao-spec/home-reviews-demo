# Rapport courant V2 : JEV court → Sol compact

Version de livraison : `jev-short-sol-compact-v2`.

Le bouton normal de l'analyse historique et les régénérations explicites créent
un identifiant d'intention persistant. `generate-historical-report` authentifie
l'utilisateur, son organisation, son rôle et sa langue ; `enqueue_current_report`
choisit le moteur enregistré dans `report_pipeline_settings`, sous le verrou
partagé du restaurant et de la langue. Un rafraîchissement ne crée rien.

Le scheduler historique existant fige les sources via `prepareHistoricalSnapshot`,
scelle le protocole, puis transmet la génération au worker JLS existant, en trois
réveils gratuits distincts. Les classifications utilisent sans modification
`jev-1.13.0`, le prompt court commun (SHA256
`84e19915b4b01af0bca311790f5a531ae23984b2d4a8cbc7d6340417ff299651`),
le sélecteur corrigé et `jls-direct4-compact-sol-v1`. Aucun appel Luna.
Les caches exigent les mêmes organisation, établissement, avis, texte,
configuration et modèle servi. Maximum un passage JEV par texte non réutilisé,
puis un appel `gpt-6.1-sol` (raisonnement `low`) si les preuves suffisent.

`historical_report_runs` sert de suivi compatible avec le bouton existant ;
`report_generation_requests` porte le lien immuable intention/source/publication.
La publication, les réponses et les usages restent dans les tables JLS et
`analysis_parallel_reports`. Les anciennes lignes Sol ne sont pas remplacées.
Le corpus, le protocole et les résultats historiques restent immuables ; seules
les colonnes de statut et de bail du nouveau suivi courant peuvent évoluer.

La préparation contrôle intégralement les sources, requêtes et SHA256 une fois.
La transaction de mise en file reconnaît exclusivement ce certificat serveur
immuable exact ; elle ne supprime aucun contrôle de compatibilité. Les tableaux
et protocoles candidats du cache sont matérialisés pour éviter leurs lectures
répétées. Sur 610 avis /526 textes réels : préparation SQL mesurée entre 6,7 et
9,8 secondes ; mise en file entre 7,3 et 7,9 secondes après correction (10,3
secondes avant). Ces deux RPC gratuits ont une limite locale de 20 secondes,
sans modification des délais globaux. Leurs transactions n'appellent aucun IA.

L'application lit le moteur actif et propose « Rapport courant · V2 » / « Rapports
précédents » (FR/VI), avec les dates, périmètres, classements et erreurs séparés.
Le composant partagé conserve l'accès aux avis négatifs/mixtes et l'audit replié.
Les liens génériques aux avis sources ne réapparaissent pas. Les indicateurs
Google existants conservent leur dénominateur, sans valeur inventée.

## Absence de doublon et reprise

L'intention, la source et la publication sont uniques ; les transactions relisent
le lien après le verrou. Les réservations existantes précèdent les transports.
Une réponse perdue reste incertaine et bloque une répétition automatique. Une
mise en file dont la réponse HTTP est perdue est retrouvée par son intention.
Le retour dans l'application ne fait que lire les états serveur. La bascule
administrative n'interrompt ni ne recalcule les générations déjà engagées.

## Déploiement et retour arrière

Appliquer les migrations de cette livraison, déployer les endpoints generate /
status /parallel-reports et les workers historique /JLS, puis vérifier leurs
probes authentifiées sans fournisseurs. Déployer GitHub Pages après CI réussie.
L'activation est une opération explicite distincte, après ces contrôles :

```sql
-- Opérateur serveur autorisé, rôle service_role ; aucun job créé ici.
select public.set_current_report_pipeline(
  'jev_sol_v2', 'User authorized promotion of the tested current V2 reports');
```

Retour arrière administratif :

```sql
select public.set_current_report_pipeline(
  'sol_legacy', 'Explicit operational rollback to the preserved Sol pipeline');
```

Ce retour change uniquement le moteur des prochains clics. Les V2 existantes
restent consultables ; aucun second rapport n'est généré automatiquement.
Chaque changement est audité dans `report_pipeline_events`. Aucun basculement
sur erreur vers un autre fournisseur ou vers l'ancien moteur.

## Vérifications de livraison

- Tests unitaires du protocole et des réveils gratuits ; tests du contrôleur de
  bouton, intention persistante après réponse perdue, accès, FR/VI et historique.
- Test Deno sans permission réseau : même worker, six JEV simulés, zéro Luna,
  un Sol simulé, réception/validation complète et refus des doubles appels.
- Rejeu local du corpus réel 610/526 avec les réponses JEV sauvegardées et Sol
  explicitement simulé : rapport techniquement validé, aucun appel fournisseur.
- SQL réel sous `service_role`, intégralement annulé : 14 assertions sur 610 avis,
  puis 26 assertions jusqu'à réservation Sol, réception, publication et suivi
  terminé sur un sous-ensemble source et une réponse explicitement simulée.
  Inclus accès inter-organisations, immutabilité, idempotence et bail concurrent.
- Playwright FR/VI : iPhone, ordinateur et largeur iPad, archives, panneau négatif,
  retour de position, absence de débordement et aucun POST fournisseur.
- Lint, Deno check, build et CI Verify avant activation.

Les mocks vérifient les raccordements et contrôles techniques ; ils ne constituent
pas une nouvelle évaluation de la qualité rédactionnelle ou sémantique de Sol.
Aucune génération payante n'est nécessaire pour cette mise en production.
