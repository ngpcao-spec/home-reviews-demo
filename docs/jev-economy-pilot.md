# Rapport pilote JEV économique — Artisan

Parcours expérimental : **Plus / Thêm → Test Jev → Rapport pilote — JEV économique**
(`/plus/jev-economy-pilot`). Aucune activation du moteur de production.

## Périmètre et audit du cache

Le snapshot gratuit initial est `f9c8876b-1b5a-4d10-9538-758881b61b6b`.
Les compteurs sont calculés à partir des données Supabase, sans valeurs codées dans l'écran.

| Compteur lors de la préparation | Nombre |
|---|---:|
| Total indiqué par Google Maps | 1 615 |
| Avis enregistrés | 523 |
| Avis avec texte original | 424 |
| Avis sans texte, jamais envoyés à JEV | 99 |
| Textes anglais prêts | 422 |
| Avis avec texte sans anglais | 2 |
| Résultats complets économiques en cache | 64 |
| Résultats réellement réutilisables | 61 |
| Textes corrigés depuis leur analyse | 3 |
| Analyses anglaises restantes | 361 |
| Réservations / facturations incertaines bloquantes | 0 |

Les deux résultats compacts présents dans le cache sont exclus. Pour chaque résultat réutilisé :
organisation, établissement, review ID, SHA256 du texte anglais, instructions, seuils,
clé canonique, modèle réellement servi, état completed, réponse des 25 thèmes et choix
stockés sont vérifiés. Le modèle des analyses réutilisables est `jev-1.13.0`.
Les trois anciennes analyses invalidées par les corrections anglaises restent conservées.

Le snapshot fige l'original, les empreintes, l'anglais résolu par `analysis-text.ts`, la
provenance des corrections validées et les sous-notes Google. Aucun auteur n'est stocké.
Un texte non anglais sans traduction disponible reste indisponible, sans fallback JEV.
Le chargement de l'écran ne crée rien. Le bouton gratuit de préparation peut créer un
nouveau snapshot ; la même source renvoie le même ID, sans modifier les anciens snapshots.

## Lecture gratuite et limites

Prévisualisation déterministe : quatre axes, mentions positives/négatives exactes,
avis distincts concernés et exemples issus du texte anglais complet. Une polarité both
compte une mention dans chaque polarité du même thème. Aucun thème n'est créé à partir
d'une note. Les notes descriptives couvrent le snapshot stocké ; le cross-rating textuel
ne porte que sur les avis réellement analysés, jamais sur des analyses manquantes.

Les 61 avis analysés contiennent 37 avis de 1–3 étoiles, 15 de 4 étoiles et 9 de 5 étoiles.
Leurs proportions ne représentent pas celles des 424 avis avec texte. Couverture textuelle
initiale : **14,39 %**. Aucune fréquence de problèmes du restaurant n'est publiée à partir
de ce sous-ensemble. La couverture Google du stockage est elle aussi partielle.

L'ancien rapport V4 vietnamien utilise un autre snapshot : 508 avis déclarés, seulement
501 IDs retrouvés, `data_complete=false`. Ses comptages, recommandations, 22 appels,
54 384 tokens d'entrée et 60 757 de sortie sont lus en DB. Son coût non enregistré reste
inconnu. La comparaison est descriptive, sans verdict de qualité. Un protocole futur
sur un snapshot identique nécessiterait une autorisation séparée et de nouveaux résultats.

## Deux étapes payantes distinctes, actuellement bloquées

La configuration figée reste **v12_economy_1pass_v1** : instructions V12 complètes,
25 thèmes, seuils historiques inchangés, requested_model=jev-latest, un passage, max 8
appels concurrents. La variante compacte n'est jamais utilisée ici.

Les cinq tables dédiées sont `analysis_jev_pilot_snapshots`, `_authorizations`, `_jobs`,
`_tasks` et `_events`. Aucun job ni autorisation payante n'est créé au déploiement.
Les autorisations doivent enregistrer un nouveau GO explicite, la source/configuration,
la phase, les IDs autorisés / nombre maximal d'appels ou le hash des agrégats Sol et la langue.
Elles ne peuvent pas être écrites par le navigateur. Sans cette autorisation serveur,
les deux boutons restent désactivés et l'API refuse leur lancement.

1. **Compléter les analyses JEV** : confirmation du coût de cette phase, tâches durables,
   nouvelle vérification atomique du cache avant dispatch, réservation permanente, une
   tentative maximum par avis. Une réponse invalide ou facturation incertaine ne provoque
   aucun retry payant. Le worker n'appelle pas Sol et ne crée pas de rapport automatique.
2. **Générer le rapport Sol** : autorisation séparée et confirmation du coût. Un seul
   appel GPT-6.1 Sol, reasoning low, pour rédiger A) les quatre axes, B) aspects positifs
   et négatifs, C) conclusions et recommandations. Il reçoit uniquement les agrégats et
   au maximum huit extraits anglais exacts bornés à 1 200 caractères, avec IDs et SHA256.
   Les comptages sont affichés par le serveur ; le texte Sol ne peut pas contenir de
   nombres inventés. Les clés de thèmes et preuves citées sont validées. Une erreur
   produit une rédaction déterministe de secours, sans nouvelle extraction ni retry.

RLS et authentification serveur owner/admin/manager de la même organisation. RPCs privées
service_role ; aucune clé fournisseur côté navigateur. Les snapshots/autorisation/events
et résultats terminés sont immuables. Le cron n'a d'effet qu'en présence d'un job déjà
autorisé et confirmé. Fermer l'iPad ne crée pas d'appel supplémentaire ; GET/pageshow
restaure les états serveur. Les réponses réseau ambiguës ne relancent pas un POST payant.

## Coûts calculés, non garantis

Base historique mesurée : 8 476,109375 tokens JEV d'entrée en moyenne, 1 125,203125 en
sortie ; prix configurés $0,042 / million en entrée et $0 en sortie. Sol : 4 162 tokens
d'entrée et 1 420 de sortie sur une précédente synthèse agrégée, tarifs persistés $2/$10
par million. Le périmètre actuel pourrait consommer un nombre différent de tokens.

| Étape | Coût supplémentaire estimé USD |
|---|---:|
| Réutiliser 61 analyses | 0 |
| 361 avis anglais sans analyse réutilisable | 0,1285147703 |
| Rédaction finale Sol | 0,022524 |
| Total connu | **0,1510387703** |
| Import Apify / traduction | Tarif indisponible — non inventé |

Ce budget concerne uniquement les textes anglais prêts du snapshot stocké, pas les
1 615 avis Google. Les deux textes sans anglais ne sont pas inclus dans les appels prévus.

## Vérification

- 1 172 tests Vitest réussis, dont 37 nouveaux tests pilote.
- Contrôles Deno des deux fonctions et tests hors réseau (11 tests économie/compact/pilote).
- Tests SQL/RLS transactionnels rollback : privilèges, contrôle de source, snapshot/job
  idempotents, coût confirmé, portée autorisée, lease, réservation unique, réponse simulée,
  coût/tokens, immutabilité, absence de chaînage Sol, absence de fuite cross-tenant.
- Lint et build réussis. Playwright FR/VI, 360/390/430/768 px, rechargement, avis justificatifs,
  boutons désactivés, zéro requête fournisseur et aucun overflow horizontal.
- 73 tables existantes vérifiées par empreinte avant/après : aucune différence.
- Un snapshot gratuit et un événement de préparation ; zéro autorisation, job ou tâche.

Les tests ne consomment aucun fournisseur. Les anciennes configurations, références IA,
rapports, benchmarks, traductions et analyses sont préservés.
