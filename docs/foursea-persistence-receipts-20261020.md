# Foursea — persistance des réponses, sans reprise fournisseur

Version : `jls-restaurant-receipt-v1`. Run historique :
`eea1bdf1-a2b1-4482-be4e-c6518d4cf214`. Archive initiale :
`a434f4cc-3233-4736-88ab-67408760337f`.

## Cause observée

`finish_jls_restaurant_task` verrouillait d'abord sa tâche, puis appelait
`save_jls_restaurant_artifact`, qui prenait `FOR UPDATE` sur la même ligne de
run pour les huit sauvegardes parallèles. Les réservations prennent les
verrous dans l'ordre inverse (run puis tâche). Le hachage JSON et l'insertion
étaient exécutés sous le verrou exclusif commun. Un réveil concurrent du
worker recalculait aussi la validité du protocole avant de vérifier le bail.

Les journaux du 20 octobre, 00:35:12–00:35:16 UTC, montrent quatre annulations
SQLSTATE `57014`, dont des attentes de 4 823,419 ms sur une transaction et
7 492,541 ms sur la ligne du run. Le timeout PostgREST reste à 8 secondes.
Le hachage isolé de huit résultats réels prend environ 100–115 ms : il ne
suffit pas à expliquer seul ces délais. Le défaut est la sérialisation des
transactions sur cette ligne, aggravée par le travail effectué sous verrou
et l'absence de reçu durable avant finalisation. Aucun dépassement CPU n'est
identifié dans cette exécution.

## Correction

- Reçu immuable par tentative dans `analysis_jls_task_receipts`, avant
  finalisation. Il conserve l'enveloppe complète, la réponse brute, ses
  empreintes, le statut et les rattachements tâche/requête/protocole.
- La capture n'acquiert aucun verrou sur le run. Sa clé étrangère référence
  la tâche, sans clé étrangère vers le run qui réintroduirait une attente
  implicite `KEY SHARE` derrière le verrou exclusif de ce dernier.
- Hachages avant les verrous. Finalisation réussie sous verrou partagé du
  run, puis verrou individuel de tâche ; même ordre run → tâche pour les
  erreurs. Finalisations drainées séquentiellement côté worker ; appels
  fournisseur inchangés, au plus huit en parallèle.
- Trois tentatives bornées **d'écriture de base uniquement**, avec la même
  enveloppe. Elles n'englobent jamais l'appel fournisseur. L'acquittement
  perdu après commit est idempotent. Aucun retry fournisseur ajouté.
- `flush_jls_restaurant_receipts` reprend uniquement la persistance des
  réponses déjà reçues avant le contrôle des tentatives abandonnées. Un run
  terminal reste terminal et nécessite une continuation explicite distincte.
- Vérification du bail actif avant le recalcul du protocole lors d'un
  réveil concurrent. Aucun délai SQL augmenté, aucune règle JEV/Luna/Sol
  modifiée, aucun plafond ou contrôle d'autorisation supprimé.
- RLS par organisation, lecture owner/admin/manager, écritures serveur,
  immutabilité et unicité par tâche. Une réponse ne peut pas être rattachée
  à une autre requête ou au mauvais worker/protocole.

Une panne avant l'arrivée de la réponse, ou avant toute écriture durable,
reste une issue inconnue. Ce mécanisme ne prétend pas rendre atomiques une
dépense externe et une transaction Postgres. Une telle tentative ne peut
jamais être renvoyée automatiquement.

## Recherche des quatre réponses

Pas de réponse retrouvée dans les artefacts des tâches, les résultats de
tâches compatibles, le cache permanent de l'organisation, les archives du
protocole, les événements et les chemins Storage accessibles. Les journaux
contiennent les erreurs SQL et les attentes de verrou ; ils ne contiennent
ni réponse brute ni corps des paramètres RPC. Les anciens mocks ne sont
pas des résultats et sont exclus. Aucun appel à une API fournisseur de
récupération n'a été effectué.

| Tâche réservée, issue inconnue | Avis |
| --- | --- |
| cda8b1fa-95c1-48f5-a750-1f398e9c3952 | 4b27f709-22b5-43de-a4e5-5ddd280ef52a |
| e7cb360e-271f-43b8-bbd9-2e66898a3605 | 6d7d524b-7bc3-47f6-8020-89496f405c90 |
| 0a3eb73c-c620-4743-bdb3-0564d02c04bf | 73a63481-989a-43e3-ba27-c32043eeab4c |
| 66690a0d-7cc2-45b4-bb0b-288609ef0a91 | 76ea982f-0303-4297-9328-6e980b6d764a |

Les tokens, modèles et résultats manquants de ces quatre tentatives restent
inconnus. Les 36 résultats acquis portent sur `jev-1.13.0` et totalisent
128 866 tokens d'entrée et 9 138 de sortie. Ce total ne couvre pas les quatre
tentatives inconnues. Les durées fournisseur enregistrées totalisent 9 345 ms,
hors attente en base et file de travail.

## Vérifications reproductibles

- `tests/unit/jls-task-persistence.test.ts` : concurrence, reçu avant
  finalisation, timeout SQL, acquittement perdu, reprise sans fournisseur,
  unicité des appels, tentative inconnue, sortie invalide et enveloppes.
- `supabase/tests/jls_task_receipts.sql` : fixture technique dans une
  transaction intégralement annulée ; huit reçus, reprise après interruption
  et bail expiré, idempotence, SHA, mauvaise requête/worker, immutabilité,
  refus de retry, RLS, historique terminal conservé. Aucun run de test commis.
- `supabase/tests/jls_task_receipts_offline_deno.ts` avec `--deny-net` :
  vérification des 36 réponses **réelles** sauvegardées, du parseur existant,
  des empreintes et des quatre tentatives inconnues ; zéro appel fournisseur.
- Qualification déployée : uniquement des résultats déjà sauvegardés,
  jamais les quatre tâches sans réponse. La qualification crée des copies
  immuables de reçus et une archive gratuite, sans modifier le run ni ses
  tâches/artefacts. Elle confirme un résultat déjà acquis et ne rouvre pas
  le run. Le test de contention maintient volontairement un verrou en
  lecture transactionnelle sur le run, sans modifier sa ligne.

Les mocks valident la persistance et l'absence de second appel, pas la
qualité sémantique du fournisseur. L'audit qualitatif reste séparé.

## Continuation possible, non lancée

Le corpus figé contient 100 avis : 91 textuels et 9 sans texte. Les 36
résultats sauvegardés restent réutilisables après vérification exacte des
empreintes. Les quatre réservations inconnues restent consommées et ne
doivent jamais devenir des tâches « pending ».

Pour une future continuation distincte explicitement autorisée : au maximum
**51 nouveaux appels JEV**, un par avis jamais tenté ; puis au maximum
**32 requêtes Luna** regroupées par avis et **un appel Sol** si les preuves
suffisent, zéro Apify et zéro retry fournisseur. Le nombre exact de tâches
Luna dépendra du dossier constitué après JEV.

Sans récupération authentique des quatre réponses manquantes, ce parcours
produirait au maximum **87/91 analyses textuelles**, pas 91/91. Les quatre
absences doivent rester visibles dans les dénominateurs et les limites du
rapport. Une analyse complète des 91 textes reste bloquée tant que ces
réponses ne sont pas retrouvées. Aucune nouvelle autorisation, aucun nouveau
run payant et aucune reprise automatique ne sont créés par cette correction.
