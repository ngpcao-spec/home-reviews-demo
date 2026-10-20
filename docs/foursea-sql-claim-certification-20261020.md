# Foursea : certification des sources et transactions de réservation

Correction expérimentale sans fournisseur. Sources : run arrêté
`ad64447b-cc9e-4f22-852b-63f43a1564f0`, diagnostic
`44fc62a2-d4be-4103-8834-b57b3b9183fe`, protocole immuable
`eaf70922-ef49-4872-a211-9b4f3206aef7`. Aucun run payant n'est rouvert.

## Cause mesurée

`claim_jls_direct4_historical_task` prenait `FOR UPDATE` sur le run, puis
appelait `jls_restaurant_valid` (hash complet du protocole) et
`check_jls_direct4_partial_sources`. Ce dernier reconstruisait notamment
les 91 tâches sources, leurs requêtes, les artefacts et les sources historiques.
Chaque réservation répétait ce travail sous le même verrou exclusif.

Mesures SQL isolées, rôle `service_role`, sources réelles :

| Opération avant correction | ms |
| --- | ---: |
| Hash du nouveau protocole | 917,182 |
| Vérification complète du protocole source | 1 035,471 |
| Agrégation de 1 583 985 octets de tâches | 120,659 |
| Hash canonique des tâches agrégées | 293,638 |
| Agrégation de 193 618 octets d'artefacts | 34,068 |
| Hash canonique des artefacts | 349,199 |
| Contrôle partiel complet | 2 780,279 |

Les sous-opérations et le contrôle complet se recouvrent : ne pas les
additionner pour prétendre mesurer un temps total. Les journaux montrent
SQLSTATE `57014` dans le contrôle des sources, pas une preuve d'attente de
verrou à cet endroit précis. Le verrou pris par l'appelant amplifie en revanche
la sérialisation ; elle est testée séparément, sans inventer une durée d'attente
historique. Les réservations historiques successives étaient espacées d'environ
quatre secondes ; la sixième a échoué.

## Correction

`certify_jls_direct4_sources` effectue une fois les contrôles complets et le
hash du protocole, hors verrou du run actif (4 099,138 ms mesurées). Un
certificat immuable lie protocole, organisation, établissement, autorité,
configuration, snapshot et sources historiques. Des références indexées et des
gardes empêchent la modification des sources certifiées, y compris l'insertion
tardive d'une tâche ou d'un artefact dans le run source. Les verrous partagés
et le verrou advisory de certification ferment la course avec les insertions.
La garde d'intégrité est un trigger à chemin de recherche fixe, non appelable
par les clients ; ses seuls accès privilégiés sont des lectures de références.

Chaque réservation conserve les contrôles vivants : appartenance/autorité,
établissement actif, consentement et son SHA, expiration, bail/worker explicites,
requête exacte, manifeste, compteur et plafond, réservation transactionnelle.
Les anciens protocoles non certifiés conservent leur chemin de compatibilité.
L'autorisation d'un nouveau protocole historique exige désormais sa certification.
Les contrôles propres aux preuves, aux verdicts Luna, à la requête Sol et aux
tokens restent présents. Aucun timeout n'est relevé, aucune règle sémantique
ou configuration JEV/Luna/Sol n'est modifiée.

## Trois états distincts

1. `request_count=1`, statut `running`, ancien champ `dispatched_at` : **réservation**.
2. Nouvelle ligne immuable `analysis_jls_task_dispatch_intents` : intention
   enregistrée immédiatement avant l'unique invocation du transport. Une
   intention seule ne prouve ni réception fournisseur ni facturation. Un
   acquittement perdu interdit tout nouvel envoi automatique.
3. Reçu immuable contenant la réponse brute, ses SHA et les observations
   `provider_fetch_invoked` / `provider_response_received`, puis artefact et
   tâche finalisés : **réponse reçue et persistée**. Ces observations ne sont
   pas une facture officielle. La capture et la finalisation restent reprenables
   sans rappeler un fournisseur lorsque le reçu existe.

Les cinq réservations réelles du run arrêté n'ont aucun marqueur d'envoi ni
reçu (la table d'intentions n'existait pas). Le code déployé v28 attendait la
fin de la boucle de huit réservations avant d'entrer dans `restaurantAttempt` ;
le timeout de la sixième, le worker/bail et les journaux sont cohérents avec
un arrêt avant l'envoi du lot. Ce raisonnement ne remplace pas une télémétrie
individuelle fournisseur, absente ici. Elles ne sont déclarées ni facturées,
ni automatiquement réexécutables ; elles restent inchangées. Les quatre
anciennes tentatives d'issue inconnue restent exclues de tout renvoi.

## Qualification SQL/PostgREST déployée

Qualification `514b1b46-fcaa-4c90-9768-f9d6e1939a39`, run **technique simulé**
`daef2ea2-49b4-467a-9a5b-c003da072d1a`, même protocole et dossier réel :

- Les RPC réellement utilisées par le port Supabase (`service_role`), via
  PostgREST, traitent 51 requêtes JEV **simulées**, 20 groupes Luna
  **simulés** (32 preuves), puis un Sol **simulé**. Le reçu brut et le résultat
  validé sont sauvegardés ; statut technique final `completed`.
- Huit réservations et huit sauvegardes parallèles, quatre réveils concurrents,
  interruption après reçu avant finalisation, puis reprise de persistance.
- Un second backend détient délibérément le verrou du run technique pendant
  2 006 ms. `pg_blocking_pids` observe un rival bloqué ; un seul worker gagne
  le bail. Les RPC de bail aboutissent en 1 570–1 635 ms, sans timeout.
- Test séparé de réponse perdue : qualification
  `3ebc50cb-3a18-47fb-b4d9-a12fa2b1a8cf`, huit transports **simulés** en échec,
  run technique `billing_uncertain`. Réveil suivant : zéro transport simulé
  supplémentaire, aucune réinitialisation de tentative.
- Idempotence des reçus et du résultat, refus d'un second claim Sol et d'un
  résultat dont le SHA a changé, refus d'un bail absent, RLS owner/autre
  organisation, immutabilité des sources/certificats et historique conservé.

| RPC déployée | Maximum observé, ms (réseau inclus) |
| --- | ---: |
| claim JEV/Luna (73 appels dont fins de file) | 822,257 |
| capture d'un reçu | 383,999 |
| finalisation d'un reçu | 156,382 |
| certificat des preuves complètes | 6 590,862 |
| liaison des preuves | 3 870,765 |
| sauvegarde du dossier Sol-ready | 6 755,623 |
| réservation Sol | 4 573,406 |
| réception Sol | 1 974,085 |
| finalisation Sol | 944,101 |

Les mesures SQL pures du rejeu transactionnel de 51 réservations sont
26,390–31,629 ms après une première exécution à 57,101 ms (premier essai
à froid : 185,455 ms). Les durées RPC ne doivent pas être présentées comme
du CPU SQL. Les étapes de préparation les plus volumineuses restent proches
de 6,8 s : marge constatée d'environ 1,2 s sur les 8 s de PostgREST, sans
garantie sous toute charge. Elles précèdent les dépenses concernées et
restent des écritures idempotentes. Aucun timeout dans ces qualifications.

Les fixtures techniques utilisent une source de consentement explicite
`technical_qualification_no_spending`, sans GO ni dépense. Une table dédiée
les enregistre. L'unicité d'un **run réel** par protocole est maintenue par un
index partiel ; les autorisations ignorent les fixtures. Celles-ci sont exclues
du scheduler, du parcours payant, des vues RLS de l'historique et des rapports.
La branche technique du worker sort avant tout chargement de clé fournisseur.
Deux tables serveur sans politique client sont volontairement inaccessibles
(`analysis_jls_source_certificate_refs`, `analysis_jls_sql_qualifications`) ;
l'avis Supabase INFO « RLS enabled, no policy » correspond à ce refus voulu.

Ces résultats testent les transactions et le raccordement, jamais la qualité
réelle de JEV, Luna ou Sol. Les réponses simulées ne sont pas des analyses.

## Contrôles du dépôt et périmètre réel

Tests ciblés, Deno `--deny-net`, SQL/RLS, lint et build passent. La première
suite locale complète a eu sept dépassements de cinq secondes ; les deux
fichiers concernés passent seuls (46 tests, limite CLI 30 s). La CI GitHub
Verify sur `adf986a` passe les 2 268 tests, lint, build et contrôle des secrets.
Les comptes rendus finaux indiquent séparément la CI du dernier commit.

Les empreintes des deux runs réels restent respectivement
`7cdbc8405a8df59b734d03c41ece6641c8dbd107599ceac5328bb0b20039f95a`
et `7c1c7c3185310b5eedb54bb9f932efbb75908deafad2d2b62212bb2e01e44763`.
Le périmètre réel reste **100 avis, 91 textuels, 9 sans texte, 36 résultats**.
Il reste 46 avis jamais réservés, cinq réservations à adjudication technique,
et quatre anciennes issues inconnues. Sans adjudication étayée des cinq,
le périmètre conservateur permettrait 36 + 46 = **82 résultats au maximum**,
pas 87 ni 91. Aucun nouveau protocole/consentement/run payant ni reprise réelle
n'est créé par ce correctif. Aucun lancement n'est proposé automatiquement.
