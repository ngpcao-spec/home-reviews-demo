# Écran Statistiques HOME Reviews

Version préparée le 19 novembre 2026 sur `codex/restaurant-statistics`, à partir de `8384fd54c9e8bbc401334a3e21b65fb8afcc22a0`. Le correctif ajoute le sous-onglet Statistiques, ses lectures serveur et sa consultation paginée des avis. Il n'est pas déployé. Aucun appel Apify ou IA et aucune écriture en production n'ont été effectués.

## Sources et historique disponible

L'audit en lecture seule trouve 28 établissements actifs, 4 077 lignes dans leurs projections `public.reviews` et un maximum de 150 lignes par établissement. Ce total de lignes n'est pas un total mondial d'avis uniques entre organisations. La conservation actuelle retire les avis anciens ; elle n'est pas modifiée ici. Les preuves figées des rapports ne constituent pas un historique exhaustif des notes et ne sont pas transformées en nouveaux avis statistiques.

La nouvelle lecture utilise toutes les lignes encore conservées pour l'établissement autorisé et, lorsque le pilote existant l'autorise, le catalogue partagé. Elle ne passe ni par `retained_review_ids` ni par une vue limitée à 150. Les copies locales et communes sont regroupées par identifiant source ; la version canonique commune est prioritaire. Les traductions ne créent aucune ligne statistique supplémentaire.

Le total annoncé par Google, le nombre conservé, les dates extrêmes et les lignes non exploitables sont distincts dans l'aide. L'écran indique une couverture partielle ou non vérifiée lorsque l'exhaustivité ne peut pas être établie. Il ne récupère pas les avis déjà supprimés de la base.

## Calculs et accès

- Période initiale : trois mois glissants. Les limites sont calculées en jours civils dans le fuseau de la politique existante, actuellement `Asia/Ho_Chi_Minh`. Le schéma ne fournit pas de fuseau propre à chaque établissement. Trente jours incluent aujourd'hui et les 29 jours précédents ; les autres fenêtres commencent à la date civile obtenue en retirant trois mois, six mois ou un an, avec ajustement de fin de mois. Aujourd'hui est une journée en cours ; les avis futurs sont exclus.
- La période précédente contient le même nombre de jours civils et se termine juste avant la période choisie. Les variations ne sont visibles que si une collecte déclarée complète et vérifiée aujourd'hui correspond au total Google, au nombre unique conservé et au nombre exploitable, sans événement de purge enregistré. Cette règle volontairement conservatrice masque les comparaisons ordinaires lorsque la couverture n'est pas prouvée. « Tout » n'a jamais de variation.
- Les notes sans texte comptent. Les notes invalides, dates absentes et dates futures sont exclues des indicateurs, et leur nombre figure dans l'aide. Une période vide a un volume nul mais aucune moyenne ni proportion inventée. Un dénominateur précédent nul produit une variation non calculable.
- La courbe utilise les semaines pour 30 jours et 3 mois, les mois au-delà. Les premières et dernières tranches peuvent être partielles. Aucun point zéro ni segment reliant deux tranches séparées par une tranche vide n'est ajouté. Les valeurs exactes restent disponibles dans un tableau repliable.
- Les trois indicateurs, les cinq barres et les polarités des sujets ouvrent la liste dédiée, avec les mêmes critères. Pagination par date et identifiant source, 30 avis par page dans le client, 50 maximum par requête serveur, sans plafond total.
- Les traductions Apify sont affichées seulement si leur empreinte correspond exactement au texte original courant et à la langue du compte. Sinon, le texte original reste visible. Une note sans texte ne reçoit aucun commentaire fabriqué.
- Les sujets proviennent des analyses JEV enregistrées en état `ready`, compatibles avec le texte affiché et sa langue. Une analyse ancienne incompatible ne contribue pas. Le partage d'une analyse exige son lien explicite au restaurant partagé. Une polarité `mixed` compte dans les deux colonnes ; les rubriques ne forment pas une répartition à 100 %. La couverture indique avis analysés / avis avec texte.

## Autorisations et performance

Les deux RPC publiques sont `read_restaurant_statistics` et `read_restaurant_statistic_reviews`. Elles appellent des fonctions privées qui vérifient la session, l'appartenance à l'organisation, l'établissement actif et la langue du profil. L'accès commun réutilise la fonction existante qui vérifie le pilote et l'abonnement. Les brouillons, notes et états privés ne sont jamais sélectionnés.

L'exécution anonyme et l'accès direct aux auxiliaires sont retirés. Les entrées autorisées ont un `search_path` vide et un contrôle d'appartenance explicite, conformément aux [règles de sécurité des fonctions Supabase](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker). La migration ne crée aucun déclencheur ni traitement fournisseur.

Les index existants couvrent les avis par établissement et identifiant source, ainsi que les dates. Un index partiel sur les analyses réussies par identifiant source complète la recherche commune. Sur la base PGlite locale de 1 205 avis : trois agrégations mesurées à 65, 61 et 70 ms ; première page à 66 ms. Ces mesures locales ne constituent pas une mesure réseau ni un engagement de latence en production. Les détails des avis restent côté serveur tant que la page correspondante n'est pas demandée.

## Contrôles exécutés

| Parcours | Résultat observé |
| --- | --- |
| Historique de 1 205 avis | 1 205 avis distincts, moyenne 3,0, 723 avis de 1 à 3 étoiles, 241 dans chaque barre. Toutes les pages SQL parcourues jusqu'au dernier avis. |
| Copies communes et locales | Même total ; aucun gonflement dû aux traductions ou à un second abonnement. |
| Autorisations | Rejet anonyme, compte hors organisation, établissement inactif et appel direct à l'auxiliaire privé. Désabonnement et désactivation du pilote empêchent la lecture commune. Aucun brouillon privé dans les réponses. |
| Traductions et sujets | Traduction compatible, retour à l'original si empreinte incorrecte, note sans texte ; avis 5 étoiles avec mention négative correctement compté selon l'analyse, analyse obsolète exclue. |
| Périodes | Date de publication, limites civiles, fin de mois, changement d'année et fuseau avec changement d'heure ; période vide, dates futures, trous dans la courbe, dénominateur nul. |
| Retour arrière | Suppression des seuls nouveaux objets ; les 1 205 avis restent présents. |
| Navigateur FR et VI | Vraie interface React et vraies RPC PostgreSQL dans la base isolée, via adaptateur HTTP de test. Formats iPhone 390 px et iPad 820 px, cinq entrées de navigation, sujets puis avis sources. |
| Liste historique mobile | 180 avis affichés après pagination ; filtre 5 étoiles ouvrant 241 avis au total ; traduction, original et absence de commentaire contrôlés ; bouton de suite dégagé de la navigation fixe. |
| Interactions | Chargement lent, erreur et bouton de réessai, état vide, changement rapide de période et restaurant, annulation de réponse dépassée, retour à Rapport. |
| Rapport existant | Les dix scénarios FR/VI passent : absent, à jour, nouveaux avis, génération en cours, échec. Synthèse conservée, détails repliés et accès aux actions inchangés. |

Résultats : **64 tests Vitest ciblés réussis**, **19 scénarios Playwright réussis**, compilation de production et ESLint réussis. Les tests navigateur utilisent des données synthétiques exclusivement dans `tests/`, sans remplacement des données du produit. Ils exécutent le rôle PostgreSQL `authenticated` avec des claims de test ; ils ne testent pas une connexion réelle au service Supabase Auth. Le moteur est Chromium aux dimensions mobiles, pas Safari sur un appareil physique.

Commandes reproductibles :

```sh
npm run test:statistics
npx vitest run tests/unit/current-report-publication-read.test.ts tests/unit/review-display-sql.test.ts tests/unit/review-display-provider.test.ts src/lib/analytics-cache.test.ts src/lib/historical-report.test.ts src/lib/historical-generation.test.ts --maxWorkers=2
npm run lint
npm run build
```

## Captures des données de test

Ces captures représentent le jeu de test, pas les chiffres réels de K.HOUSE.

- [iPhone français](evidence/restaurant-statistics-20261119/statistics-fr-iphone.png)
- [iPhone vietnamien](evidence/restaurant-statistics-20261119/statistics-vi-iphone.png)
- [iPad français](evidence/restaurant-statistics-20261119/statistics-fr-ipad.png)
- [iPad vietnamien](evidence/restaurant-statistics-20261119/statistics-vi-ipad.png)
- [Répartition des notes](evidence/restaurant-statistics-20261119/statistics-charts-fr-iphone.png)
- [Sujets cités](evidence/restaurant-statistics-20261119/statistics-topics-fr-iphone.png)
- [Comparaison vérifiée](evidence/restaurant-statistics-20261119/statistics-fr-comparison-iphone.png)
- [Avis sources](evidence/restaurant-statistics-20261119/statistics-reviews-fr-iphone.png)

## Livraison et retour arrière

Après validation du correctif, appliquer uniquement la migration additive `20261119105944_restaurant_statistics_readonly.sql`, puis publier le client. Aucun script de purge, de rattrapage, d'import ou de génération n'est nécessaire. La migration ne change ni les politiques de conservation ni les réservations du pilote.

Pour revenir en arrière : restaurer d'abord le client précédent, puis appliquer `scripts/rollback/restaurant-statistics.sql` si la suppression des RPC est souhaitée. Ce script retire uniquement les sept fonctions et le nouvel index. Il ne modifie aucune donnée de restaurant, avis, traduction, menu ou rapport. Le maintien des RPC inutilisées est également possible pendant un retour arrière du client.

Les limites restantes sont la disponibilité réelle de l'historique, l'absence de fuseau individuel dans le schéma actuel, le contrôle Safari physique et la validation réseau après un éventuel déploiement. Le correctif ne promet pas de reconstituer les avis déjà purgés.
