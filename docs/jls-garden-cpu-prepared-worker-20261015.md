# Xóm Mới Garden — worker préparé et budget CPU

Cette livraison prépare une nouvelle reprise expérimentale. Aucun consentement,
run ou appel fournisseur n'est créé. Les deux runs arrêtés restent immuables.
Aucune estimation monétaire.

## Diagnostic mesuré

Audit archivé `acf9f869-7b4a-404a-b465-b329bd63f751`, SHA256
`15d6bea3240d78d6eb4da503eb4239a67c307c6e427cbb4c975f5609c70c96fc`.
Run arrêté `a43c1786-9e8b-4b56-9672-f3e34c1b6a93`, autorisation inutilisable.
Le journal Supabase constate `CPUTime`, 2 428 ms CPU et 119 815 170 octets
mémoire. Aucune tâche ni tentative fournisseur.

Profil local sur les mêmes sources figées, sans permission réseau (Deno 2.9.6) :

| Opération | CPU ms | Durée totale ms |
| --- | ---: | ---: |
| Vérification complète à froid avant correction | 2 328 | 1 801 |
| Initialisation du tokenizer | 814 | 637 |
| Empreinte du protocole | 77 | 31 |
| Vérification des 587 sources | 109 | 25 |
| Audit des 78 caches | 32 | 37 |
| Reconstruction du plan, tokenizer déjà initialisé | 578 | 492 |
| Dossier éditorial complet, tokenizer déjà initialisé | 656 | 540 |
| Reconstruction complète à chaud à chaque réveil | 1 282 | 1 071 |

Mesures de composants séparées et non additives ; variation de compilation/JIT.
Le CPU agrège user + system et peut dépasser la durée totale sur plusieurs
threads. La limite [Edge documentée](https://supabase.com/docs/guides/functions/limits)
est 2 000 ms CPU, distincte des durées réseau et totale.

## Correction

- `jls-deterministic-artifacts-v1` : le sélecteur, le plan, les 28 requêtes Luna,
  les 32 citations, les contextes, les statistiques et le dossier conditionnel
  sont construits une fois, puis conservés dans une table immuable avec RLS.
- `jls-restaurant-prepared-vi-v1` : nouveau protocole lié à cet artefact et au
  protocole source `2f7d02b1-05dd-4b32-a2a9-e98b25a8db85`. Aucun ancien GO repris.
- Le worker contrôle les empreintes du protocole, du plan, des sources, des
  citations, du cache courant et des requêtes effectivement utilisées ; il ne
  relance pas le compilateur ou le sélecteur à chaque réveil.
- Le contrôle de compatibilité des 78 caches renvoie un booléen depuis Postgres,
  au lieu de transférer et reconstruire les mêmes réponses volumineuses.
- Le contrôle utilisateur avant prise du bail charge seulement l'identité et
  l'état nécessaires. Les réveils concurrents quittent avant le chargement lourd.
- `jls-o200k-frozen-measurements-v1` : mesures par chaîne exacte, versionnées,
  avec SHA256. Mémo isolé par objet plan ; aucun partage entre organisations.
  Durant l'envoi et la validation, le mémo est scellé : une mesure absente
  bloque, au lieu de déclencher une tokenisation imprévue.
- Une étape durable gratuite `prepare_sol` sépare la fin de Luna de la
  construction du dossier ACCEPTED. Seules ses chaînes nouvelles sont mesurées.
  La requête complète et sa mesure restent sous 32 768 tokens d'entrée,
  9 500 de sortie et 1 Mio. La chaîne HTTP exacte est conservée et vérifiée
  pour résister au réordonnancement JSONB.
- Consentement récent et borné, appartenance/compte actif, bail, réservation
  atomique et plafond d'une tentative par avis restent obligatoires.
- Les décisions Luna natives sont reparsées et liées à leurs preuves avant Sol.
  Le filtre de confiance et tous les contrôles de recommandations restent actifs.
  Aucune relance payante, même après interruption ou validation défavorable.

Les 78 résultats JEV compatibles sont conservés. Aucun résultat Luna n'existe
sur ces 32 preuves ; il resterait 28 requêtes Luna et au plus un Sol après un
nouveau GO et le contrôle de suffisance. Aucun Apify, import ou traduction.

## Mesures après correction, dossier réel figé, sans réseau

| Phase isolée | CPU ms | Durée totale ms | Marge sur 2 000 ms |
| --- | ---: | ---: | ---: |
| Vérifier les artefacts et les 28 requêtes | 141 | 101 | 1 859 |
| Préparer Sol avec un sous-ensemble non pré-tokenisé | 1 453 | 1 002 | 547 |
| Avant envoi et validation de sortie simulée | 250 | 197 | 1 750 |

Les citations et contextes sont inchangés. La normalisation déterministe de
l'ordre des clés conserve 67 867 octets mais fait varier l'estimation locale :
19 176 tokens, 21 734 avec 12 % + 256, 11 034 disponibles sous le plafond.
Les tokens locaux ne sont pas des tokens facturés.

Reproduction : `scripts/profile-jls-prepared.ts`, avec `--cached-only --allow-read`
et **sans** `--allow-net`. Le fichier réel de sources reste hors du dépôt.

## Mesure représentative sur Supabase Edge

Le mode serveur `cpu_probe` est réservé au jeton scheduler et aux rôles autorisés.
Il termine avant le chargement des clés fournisseur et ne crée aucune tâche,
aucun consentement ni run. Seuls Supabase Auth/Postgres sont utilisés.
Il exécute les mêmes vérifications, compile une variante de taille et contrôle
une sortie strictement simulée en mémoire. Aucun faux verdict Luna ou rapport
n'est enregistré dans les tables d'expérience. Seuls métriques et empreintes
techniques sont sauvegardées dans `analysis_jls_restaurant_cpu_probes`.
Le compteur `process.cpuUsage()` renvoie un zéro factice sur cet Edge Deno 2.1.4.
Il est donc enregistré comme indisponible, jamais interprété comme zéro CPU.
La première sonde conserve son ancien champ brut à zéro ; l'attestation séparée
ci-dessous en donne la mesure native correcte, sans modifier cette trace.

Mesures réelles des journaux Supabase `Shutdown.cpu_time_used`, région
`ap-southeast-1`, runtime 1.77.0 compatible Deno 2.1.4 :

| Étape | CPU natif ms | Durée de la sonde avec I/O ms | Marge CPU ms |
| --- | ---: | ---: | ---: |
| Vérifier les sources, artefacts et 28 requêtes | 237 | 3 055 | 1 763 |
| Préparer un dossier ACCEPTED non pré-tokenisé | 1 685 | 5 112 | 315 |
| Contrôler avant envoi et valider une sortie simulée | 296 | 3 173 | 1 704 |

Une sonde à froid par version de déploiement (3 / 4 / 5), sans trafic fournisseur.
La durée totale attend Supabase Auth/Postgres ; ce n'est pas du CPU.
La marge minimale observée est 315 ms (15,75 %). Ces sondes exercent les fonctions
réelles avec le dossier figé, des décisions et une sortie techniques en mémoire.
Elles ne sont ni une nouvelle exécution métier ni une garantie pour toute sortie
future ou toute charge. Le bail, les écritures SQL et les réponses réseau restent
testés séparément ; les mesures de CPU ne constituent pas un benchmark fournisseur.

Sondes immuables :

- Vérification : `ba53144c-65e1-4d6f-a432-2714967fa312`, exécution Edge
  `0b1c2755-f90c-4c68-95cd-41194c2404ef`.
- Préparation : `3175c02e-0406-4026-a211-e03324cc0aec`, exécution Edge
  `71123b70-7acb-4b9d-938f-95ee8e9b6016`.
- Avant envoi/validation : `acb58e1b-360d-414e-a7d6-baf01189b25e`, exécution Edge
  `db753645-7a76-4819-bf1d-73252417ccd3`.
- Attestation des journaux natifs : `2cf3c73f-bf78-4a72-9063-f7909a97f870`,
  dans `analysis_jls_restaurant_cpu_probes`, avec références et provenance.

## Nouveau protocole prêt, sans autorisation

- ID : `6c7145e2-e519-465b-b0af-bdd64cec5971`.
- Version : `jls-restaurant-prepared-vi-v1`.
- SHA256 protocole :
  `0b38353cbc107d0127d500a4c9e559fe716db2be610581bd5a3308396ccea195`.
- SHA256 artefact :
  `dcb701594f79fab7ea3963870340eda46362a8bbea787f7eeedbdebd3a4f374f`.
- Provenance du compilateur : `e31976c9aff43f2933dd2d26b233e8030bfa34fb`.
- Protocole/artefact relus depuis JSONB puis vérifiés hors réseau : conforme.
- 78 analyses réutilisables ; 0 nouvel appel JEV ; 32 questions regroupées en
  28 appels Luna maximum ; 1 Sol maximum si la suffisance est acquise.
- Zéro consentement, run et tâche pour ce protocole. Les deux anciens runs
  restent bloqués et inchangés. Un nouveau GO est indispensable.

Les migrations sont appliquées ; `process-jls-restaurant` version 5 et
`jls-restaurant` version 3 sont actives. GitHub Pages a déployé le code
`2b412a34de0dc944272ec2001eaf7060b7629bef` (workflow `38695198362` réussi).
Le garde SQL de taille est également conservé sur les protocoles préparés,
en plus du contrôle TypeScript avant réservation/envoi.

## Contrôles

1 770 tests unitaires de la suite complète initiale ; CI complète suivante
réussie après ajout du test du compteur CPU indisponible (1 771 tests attendus).
39 régressions ciblées réussies après renforcement du garde SQL de taille.
3 tests Deno sans réseau, tests SQL/RLS avec rollback,
8 tests FR/VI (360/390/430 et iPad 768), lint, build et Deno check/lint.
Régressions : concurrence, réveils répétés, interruption, absence/expiration du
GO, sources/cache/artefact/certificat modifiés, données volumineuses, mesures
manquantes, regroupement Luna et un seul Sol. Les contrôles historiques restent
applicables et les rapports Artisan ne sont pas modifiés.
SQL supplémentaire : dépassement d'entrée, dépassement de sortie et politique
modifiée refusés ; requête conforme acceptée avec zéro tentative, transaction
intégralement annulée. Aucun faux verdict Luna n'est conservé.
