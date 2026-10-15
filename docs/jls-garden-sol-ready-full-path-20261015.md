# Xóm Mới Garden — requête Sol figée et parcours Edge complet

Livraison du 15 octobre 2026. Aucune exécution fournisseur pendant cette
intervention. Aucun consentement, run payant ou autorisation de dépense enregistré.
Les sondes techniques sont explicitement des mocks, séparés des runs historiques.
Aucune estimation monétaire n'est produite.

## Diagnostic et cause mesurée

Diagnostic source : `b32eb864-ee18-4deb-b231-05664f080eb3`.
Run historique bloqué : `16587a3a-1591-4ca5-b813-1a911ec9a0da`,
protocole `6c7145e2-e519-465b-b0af-bdd64cec5971`.
Son état reste `blocked / JLS_EDGE_CPU_LIMIT_BEFORE_SOL_DISPATCH`.

Le journal natif Supabase a enregistré 2 032 ms CPU et 105 774 470 octets mémoire
avant Sol. La précédente sonde de composants ne couvrait pas le worker entier.

Profil local du dossier réel, Deno 2.9.6 sans permission réseau :

| Étape | CPU ms | Durée ms |
| --- | ---: | ---: |
| Vérification du protocole et des 587 sources | 94 | 63,5 |
| Empreintes des 31 artefacts | 15 | 6,3 |
| Plan figé et certificat | 125 | 34,6 |
| Relecture des 28 réponses Luna natives | 16 | 20,1 |
| Reconstruction ACCEPTED et tokenisation | 1 093 | 948,2 |
| Certificat final et sérialisation | 16 | 14,6 |
| Total du profil | 1 375 | 1 092,8 |

La reconstruction/tokenisation représentait environ 79 % du CPU mesuré localement.
Ces chiffres locaux ne sont pas une preuve de conformité Edge.

Les tests Edge complets ont également révélé des délais SQL : le contrôle
recalculait deux fois l'empreinte du protocole source volumineux. Mesure Postgres :
4 408,167 ms avant, 360,231 ms après. Ce sont des durées SQL, pas du CPU Edge.
L'empreinte complète du parent est vérifiée au scellement ; ce parent est
immuable. Chaque réveil vérifie toujours l'intégralité du nouvel artefact utilisé,
du nouveau protocole, de la requête et des sources JEV/Luna réellement liées.

## Architecture livrée

- `jls-sol-ready.ts` compile hors du chemin de dispatch la requête finale issue
  des décisions Luna natives sauvegardées. Le sélecteur, la reconstruction du
  dossier accepté et les tokenisations ont lieu une fois.
- La requête HTTP littérale, le dossier complet, les versions et empreintes,
  les contextes, le manifeste des tâches Luna et les mesures de tokens exactes
  sont conservés dans un artefact immuable sous RLS.
- `jls-sol-ready-worker.ts` partage le même parcours métier entre le transport
  réel futur et un transport HTTP simulé explicitement injecté.
- Réveil 1 : contrôles d'identité, organisation, consentement et compatibilité ;
  réservation atomique ; au plus un envoi ; sauvegarde durable de la réponse
  brute et de son empreinte avant toute validation sémantique.
- Réveil 2 : contrôle de cette réception, extraction de l'usage et du modèle,
  validation éditoriale existante inchangée, puis sauvegarde du résultat et des
  contrôles. Aucun nouvel envoi.
- Un mémo de tokens scellé refuse toute chaîne non mesurée. Zéro tokenisation
  pendant les deux réveils.
- Une tentative réservée sans réponse est consommée et devient incertaine ;
  aucun retry fournisseur. Une validation interrompue peut reprendre uniquement
  depuis la réception persistée, sans redispatch.
- L'interface FR/VI distingue la préparation Sol seule, les analyses réutilisées,
  la réception et la validation. Le lancement reste fermé sans nouveau GO.

Tables séparées : `analysis_jls_sol_ready_artifacts`,
`analysis_jls_sol_ready_operations`, `analysis_jls_sol_ready_checks`.
Les opérations de test sont `mode=mock`, sans consentement ni run.
Écritures serveur uniquement ; lectures owner/admin/manager de la même organisation.

## Réutilisation et dossier conservé

- 78 résultats JEV V12 économiques complets, empreintes et configuration
  exactement compatibles ; zéro nouvel appel JEV.
- 28 tâches Luna terminées, chacune avec `request_count=1`, couvrant 32 décisions :
  30 ACCEPTED, 1 REJECTED, 1 UNCERTAIN. Zéro nouvel appel Luna.
- Les 32 citations et leurs contextes restent dans le dossier source et l'audit.
  Seules les 30 preuves ACCEPTED sont admissibles dans la requête Sol.
- Statistiques : 587 avis stockés, 550 avec texte, 78 textes anglais analysés.
  Les 472 autres textes ne sont pas présentés comme analysés.
- Requête finale : 64 929 octets ; mesure locale 18 245 tokens d'entrée ;
  mesure gardée 20 691 après marge de 12 % + 256.
- Limite maintenue : 32 768 tokens d'entrée, 9 500 réservés à la sortie ;
  marge d'entrée disponible 12 077 tokens. Aucun contexte supprimé.

Les tokens locaux ne sont pas des tokens facturés.

## Vérification du parcours entier sur Edge déployé

Worker v7, région Singapour, Supabase Edge Runtime 1.77.0 / Deno 2.1.4.
Transport simulé sans accès réseau fournisseur. Le même adaptateur Supabase
charge les sources réelles, vérifie Auth et les rôles, réserve, sauvegarde la
réception, puis valide et sauvegarde le résultat.

| Sonde / étape | CPU natif ms | Durée métier ms | Mémoire observée heap + externe octets | Mémoire native à l'arrêt octets |
| --- | ---: | ---: | ---: | ---: |
| Normale, réception et sauvegarde | 219 | 6 516 | 51 821 502 | 27 937 583 |
| Normale, validation et sauvegarde | 354 | 7 418 | 41 862 703 | 28 317 063 |
| Volumineuse, réception et sauvegarde | 296 | 6 430 | 50 613 118 | 27 937 047 |
| Volumineuse, validation et sauvegarde | 383 | 9 837 | 43 087 718 | 28 584 871 |

CPU tiré des événements natifs `Shutdown.cpu_time_used`, et non d'un compteur
Deno renvoyant un faux zéro. Le CPU inclut tout l'isolate. La durée métier
inclut Auth, vérifications SQL, réservation, transport simulé et sauvegarde ;
le préchargement supplémentaire de la fixture de sonde est hors de cette durée.
La mémoire est observée, pas un pic garanti. Le réseau explique une part
importante de la durée totale et ne doit pas être confondu avec le CPU.

Marge CPU minimale constatée : 1 617 ms sur 2 000 ms (80,85 %).
Critère de qualification : au moins 500 ms de marge et mémoire < 256 Mio.

La réponse normale de 9 773 octets est validée et sauvegardée `completed`.
La réponse de stress de 392 067 octets est sauvegardée `needs_review` :
ses recommandations synthétiques insuffisamment justifiées restent bloquées.
Ce ne sont pas des rapports Sol réels ni des références IA.
Un réveil concurrent ne déclenche aucun deuxième envoi simulé.

Sondes persistées :
- normale : `d6827ecd-12c8-448f-acb8-3d5f8dcd0100` ;
- volumineuse : `9514e9a3-1b7b-4b40-9926-48c211782311`.

Exécutions natives :
- réception normale : `612fb62f-8cd6-447b-965b-59ad505a52ca` ;
- validation normale : `e3503009-01a9-436d-8662-d0fe4c616c86` ;
- réception volumineuse : `7aaac63f-800a-4f2d-9610-37731a6395a3` ;
- validation volumineuse : `984c00d5-6e32-4153-93f6-fe22121129de`.

Les premières sondes v6 ayant révélé les délais SQL sont conservées ;
elles ne constituent pas la qualification finale.

## Nouveau protocole prêt, sans autorisation d'exécution

- Protocole : **`6be7ae90-93f2-4a3a-abdd-8766f5a02ada`**.
- Version : `jls-restaurant-sol-ready-vi-v1`.
- SHA256 protocole :
  `e1f4c5156c888676b44aee96c4ec4dec258aec839122670dc54bdf56c4f756a4`.
- Artefact : `8d3eaf1e-a3df-4494-963a-bba86287fc0f`.
- SHA256 artefact :
  `f59f202ea85dff060c79195e52990300ed1bc9faeb4cd0e43c235dea2ef35dc8`.
- Qualification immuable : `ea12b967-3d3f-44d0-ad22-6fdade6ad62d`.
- Empreinte de l'artefact des décisions Luna source :
  `2a4507251a19ca893faf7e9827015dcfdab7faf1945fa31e1b42ab6f518862a7`.
- Plafonds : JEV 0, Luna 0, Sol 1, Apify 0 ; aucun retry automatique.
- Compilation : commit `c0a76fbe6ba49a2df129d5e965f61f438b41848c`.
- Code runtime mesuré : `d233b42ccf854cedebb0741908456fa7f3469fbb`.
- Bundle worker v7 :
  `b75e851570766b8285dddd9ede718ee685164e9428e949eb810802aaa9ff74a1`.

Le protocole est un objet de préparation. Son enregistrement ne crée ni
consentement, ni run, ni tâche payante. Les trois anciens runs restent bloqués.
Le nouveau GO doit nommer ce protocole ; les anciennes autorisations ne servent pas.

## Tests et déploiement

- 15 tests unitaires ciblés : parcours complet, concurrence, réveils répétés,
  résultat existant, modification d'artefact, permissions, source incompatible,
  timeout, réception perdue, reprise de validation, modèle/JSON/usage invalides,
  refus fournisseur et absence de redispatch.
- Suite complète : 1 786 tests unitaires, lint et build passés dans la CI
  [38716043721](https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/38716043721).
- 5 tests Deno sans permission réseau et contrôles Deno/lint des nouveaux modules.
- SQL/RLS : unicité, immutabilité, idempotence, réservation concurrente,
  réponse perdue consommée, séparation des organisations et refus des écritures navigateur.
- Parcours SQL du mode d'exécution réel testé avec données synthétiques dans une
  transaction annulée : GO absent/expiré/mauvais périmètre, unique tâche Sol,
  réception durable, transition received → validation → résultat et absence de retry.
  Aucun de ces consentements/runs de test n'est conservé.
- 16 tests FR/VI iPhone 360/390/430 et iPad 768, rechargement, bouton fermé,
  absence de POST fournisseur et de débordement.
- Migrations appliquées ; API `jls-restaurant` v4 et worker
  `process-jls-restaurant` v7 actifs ; interface GitHub Pages déployée.
- Conseiller Supabase : aucun nouveau signal de sécurité sur les objets créés.
- Les cinq empreintes historiques Artisan et les trois lignes de runs Garden
  sont identiques à leurs références avant intervention.

## Limites

Les mesures valident le dossier figé et deux tailles de réponses simulées,
y compris le travail après réception. Elles ne garantissent pas toute sortie
future, toute charge plateforme ou la qualité sémantique d'un rapport.
Les contrôles techniques ne constituent pas une validation humaine.
Une réponse fournisseur perdue ou une facturation incertaine entraîne un arrêt ;
une réponse invalide est conservée sans appel de correction.

**Zéro appel JEV, Luna, Sol ou Apify pendant cette correction.
Attendre un nouveau GO avant l'unique appel Sol réel.**

