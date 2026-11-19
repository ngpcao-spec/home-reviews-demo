# Écran Statistiques HOME Reviews

Version préparée le 19 novembre 2026 sur `codex/restaurant-statistics`. Le correctif ajoute le sous-onglet Statistiques, ses lectures serveur et sa consultation paginée des avis. Le [raccordement à l'historique durable](review-history.md) complète maintenant cette version : migrations, contrôles, déploiement et retour arrière y sont décrits. Rien n'est déployé. Aucun appel Apify ou IA et aucune écriture en production n'ont été effectués.

## Sources et historique disponible

L'audit préalable en lecture seule avait trouvé 28 établissements actifs, 4 077 lignes dans leurs projections `public.reviews` et un maximum de 150 lignes par établissement. Ce total n'est pas un total mondial d'avis uniques entre organisations. Le nouveau corpus est initialisé avec les seules lignes actuellement présentes, puis conserve les avis reçus au-delà de la fenêtre active des 150. Aucune ancienne archive n'est recherchée ou restaurée. Les preuves figées des rapports ne sont pas transformées en nouveaux avis statistiques.

La nouvelle lecture utilise toutes les lignes de `private.review_history` pour l'établissement autorisé et, lorsque le pilote existant l'autorise, le restaurant partagé. Elle ne passe ni par `retained_review_ids` ni par une vue limitée à 150. Les copies locales et communes sont regroupées par identifiant source ; la version canonique commune est prioritaire. Les traductions et modifications ne créent aucune ligne statistique supplémentaire. La liste détaillée utilise exactement cette même source.

Le total annoncé par Google, le nombre conservé, les dates extrêmes et les lignes non exploitables sont distincts dans l'aide. L'écran indique une couverture partielle ou non vérifiée lorsque l'exhaustivité ne peut pas être établie. Il ne récupère pas les avis déjà supprimés de la base.

## Calculs et accès

- Période initiale : trois mois glissants. Les limites sont calculées en jours civils dans le fuseau de la politique existante, actuellement `Asia/Ho_Chi_Minh`. Le schéma ne fournit pas de fuseau propre à chaque établissement. Trente jours incluent aujourd'hui et les 29 jours précédents ; les autres fenêtres commencent à la date civile obtenue en retirant trois mois, six mois ou un an, avec ajustement de fin de mois. Aujourd'hui est une journée en cours ; les avis futurs sont exclus.
- La période précédente contient le même nombre de jours civils et se termine juste avant la période choisie. La date de début de conservation est affichée séparément des dates des avis. Le lot initial et le total Google ne prouvent pas une couverture continue : les comparaisons restent masquées tant que cette couverture n'est pas certifiée. Aucune certification automatique des périodes n'est ajoutée dans ce correctif. « Tout » n'a jamais de variation.
- Les notes sans texte comptent. Les notes invalides, dates absentes et dates futures sont exclues des indicateurs, et leur nombre figure dans l'aide. Une période vide a un volume nul mais aucune moyenne ni proportion inventée. Un dénominateur précédent nul produit une variation non calculable.
- La courbe utilise les semaines pour 30 jours et 3 mois, les mois au-delà. Les premières et dernières tranches peuvent être partielles. Aucun point zéro ni segment reliant deux tranches séparées par une tranche vide n'est ajouté. Les valeurs exactes restent disponibles dans un tableau repliable.
- Les trois indicateurs, les cinq barres et les polarités des sujets ouvrent la liste dédiée, avec les mêmes critères. Pagination par date et identifiant source, 30 avis par page dans le client, 50 maximum par requête serveur, sans plafond total.
- Les traductions Apify sont affichées seulement si leur empreinte correspond exactement au texte original courant et à la langue du compte. Sinon, le texte original reste visible. Une note sans texte ne reçoit aucun commentaire fabriqué.
- Les sujets proviennent des analyses JEV enregistrées en état `ready`, compatibles avec le texte affiché et sa langue. Une analyse ancienne incompatible ne contribue pas. Le partage d'une analyse exige son lien explicite au restaurant partagé. Une polarité `mixed` compte dans les deux colonnes ; les rubriques ne forment pas une répartition à 100 %. La couverture indique avis analysés / avis avec texte.

## Autorisations et performance

Les deux RPC publiques sont `read_restaurant_statistics` et `read_restaurant_statistic_reviews`. Elles appellent des fonctions privées qui vérifient la session, l'appartenance à l'organisation, l'établissement actif et la langue du profil. L'accès commun réutilise la fonction existante qui vérifie le pilote et l'abonnement. Les brouillons, notes et états privés ne sont jamais sélectionnés.

L'exécution anonyme et l'accès direct aux auxiliaires sont retirés. Les entrées autorisées ont un `search_path` vide et un contrôle d'appartenance explicite, conformément aux [règles de sécurité des fonctions Supabase](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker). La migration de lecture ne crée aucun traitement fournisseur ; les migrations d'historique ajoutent uniquement les captures locales décrites dans le dossier associé.

Les index de l'historique couvrent portée, date et identifiant source. Un index partiel sur les analyses réussies par identifiant source complète la recherche commune. Sur la base PGlite locale de 1 205 avis : trois agrégations mesurées à 417, 414 et 424 ms ; première page à 482 ms. Ces mesures locales ne constituent pas une mesure réseau ni un engagement de latence en production. Les détails des avis restent côté serveur tant que la page correspondante n'est pas demandée.

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

Résultats du raccordement : **66 tests Vitest ciblés réussis**, **1 test PostgreSQL natif de concurrence et de droits réussi**, **19 scénarios Playwright réussis**, compilation de production et ESLint des fichiers concernés réussis. Les tests navigateur utilisent des données synthétiques exclusivement dans `tests/`, sans remplacement des données du produit. Ils exécutent le rôle PostgreSQL `authenticated` avec des claims de test ; ils ne testent pas une connexion réelle au service Supabase Auth. Le moteur est Chromium aux dimensions mobiles, pas Safari sur un appareil physique. Le [dossier de conservation](review-history.md) précise les fonctions réelles exécutées et les limites.

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
- [Couverture initiale et date de conservation](evidence/restaurant-statistics-20261119/statistics-fr-comparison-iphone.png)
- [Avis sources](evidence/restaurant-statistics-20261119/statistics-reviews-fr-iphone.png)

## Livraison et retour arrière

Après validation, appliquer dans l'ordre les migrations `20261119105944_restaurant_statistics_readonly.sql`, `20261119120255_retained_review_history.sql`, `20261119120531_statistics_retained_history.sql`, puis le worker de synchronisation et le client, selon le [dossier de déploiement](review-history.md#déploiement-proposé--non-exécuté). Aucun script de purge, rattrapage, import ou génération n'est nécessaire. La fenêtre active et les réservations du pilote restent inchangées.

Pour revenir en arrière, distinguer le client, les captures d'historique et les RPC : voir la [procédure précise](review-history.md#retour-arrière). `scripts/rollback/review-history.sql` arrête les captures sans effacer les données conservées. Le retrait ultérieur des seules RPC reste possible via `scripts/rollback/restaurant-statistics.sql`. Ne pas rejouer une migration de création sur des tables conservées.

Les limites restantes sont la disponibilité réelle de l'historique, l'absence de fuseau individuel dans le schéma actuel, le contrôle Safari physique et la validation réseau après un éventuel déploiement. Le correctif ne promet pas de reconstituer les avis déjà purgés.
