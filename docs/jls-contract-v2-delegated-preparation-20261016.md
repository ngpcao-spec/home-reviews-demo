# Xóm Mới Garden — préparation déléguée du contrat V2

Cette livraison prépare une seule exécution vietnamienne, sans dépense,
consentement ou run payant. Le protocole est distinct du run historique
`4ba0bf81-0ee0-496f-806f-7259fa19e496` et de son autorisation consommée.
Source : archive `cf693741-5e08-4e4f-b3e1-2a8cc4dcbd9b`.

## Périmètre et réutilisation

- Les 78 analyses JEV économiques restent exactement compatibles.
- Les 28 réponses Luna sources contiennent 32 décisions natives.
- 31 décisions sont reprises à l'identique, y compris la seconde question du
  même avis que la citation de commande remplacée. Les groupes historiques
  conservent leurs requêtes et leurs empreintes ; ils ne sont jamais renvoyés.
- L'ancienne citation générale de commande et son verdict restent dans
  l'historique. Ils ne sont pas utilisés pour accepter la nouvelle citation.
- Nouvelle preuve : `b44673fb1f5da6d3b43f030a4622090a9156e505f6cb810b2a34e0c859b69592`.

> they only brought out one drink instead of the two ordered

Une seule question Luna est préparée avec la citation exacte et l'avis anglais
complet. Aucun résultat Luna antérieur n'existe pour cette nouvelle preuve.
Les notes Google, références GPT-6 et verdicts précédents ne sont pas envoyés.

## Contrat, branches et limites

Protocole : `jls-contract-v2-garden-delegated-vi-v1`.
Rapport : `jls-prioritized-recommendations-v2`.
Maximum : JEV 0, Luna 1 requête / 1 question, Sol 1, Apify 0.
Aucun retry fournisseur, SDK ou changement d'API.

Trois branches conditionnelles sont compilées hors du worker : ACCEPTED,
REJECTED et UNCERTAIN. Ce ne sont pas des prédictions ni des annotations IA.
La branche effective sera choisie uniquement depuis la nouvelle réponse Luna
native et le filtre de confiance inchangé.

| Issue Luna future | Preuves acceptées pour Sol | Requête complète | Entrée locale | Entrée avec marge | Sortie réservée |
| --- | ---: | ---: | ---: | ---: | ---: |
| ACCEPTED | 30 | 71 884 octets | 19 715 | 22 337 | 9 500 |
| REJECTED | 29 | 70 262 octets | 19 252 | 21 819 | 9 500 |
| UNCERTAIN | 29 | 70 262 octets | 19 252 | 21 819 | 9 500 |

Limite conservée : 32 768 tokens d'entrée, requête HTTP < 1 Mio.
Les mesures locales ne sont pas des tokens facturés. Aucune estimation monétaire.
Les trois contrôles de suffisance passent : quatre axes, au moins huit preuves,
critiques et avis faibles selon la politique existante. Si Luna rejette la nouvelle
preuve ou reste incertaine, elle est absente du dossier Sol ; aucune recommandation
de commande ne doit être forcée. Zéro à cinq propositions restent admissibles.

## Architecture réutilisée

Le pipeline commercial, le sélecteur V1.1 et les anciens runs restent inchangés.
Le parseur natif et le filtre Luna existants sont réutilisés. Le worker Sol durable
`processReadySol` conserve sa réservation, sa réception brute avant validation et
sa sauvegarde séparée. Un adaptateur V2 sélectionne le nouveau validateur.
Les appelants historiques gardent leur chemin et leur format.

Quatre étapes persistantes : `luna`, `validate_luna`, `sol`, `validate_sol`.
Une seule étape par réveil. Les requêtes littérales, instructions, schémas,
citations, contextes et statistiques sont figés avec SHA256. Les mesures des
enveloppes intermédiaires inutilisées sont retirées du certificat ; toutes les
chaînes réellement utilisées gardent leurs empreintes. Le mémo est scellé pendant
le dispatch et la validation : aucune nouvelle tokenisation autorisée.

Tables expérimentales dédiées :
`analysis_jls_contract_v2_protocols`, `analysis_jls_contract_v2_operations`,
`analysis_jls_contract_v2_checks`. RLS owner/admin/manager de la même organisation,
écritures serveur uniquement, protocoles et résultats immuables, unique opération
payante par protocole et deux compteurs bornés à 0/1.

Le futur GO devra être récent, propre au protocole et à son périmètre exact,
avec expiration sous 24 heures et provenance `user_directive_codex_delegation`.
Il sera enregistré uniquement après une nouvelle instruction explicite.
La qualification des trois parcours Edge simulés est exigée avant autorisation.
L'identité active et l'appartenance sont vérifiées à chaque réveil ; la réservation
transactionnelle revérifie le consentement avant toute dépense.

Une tentative sans réception est consommée et devient incertaine. Une réponse
invalide ou insuffisamment justifiée est conservée sans appel de correction.
Une reprise de validation ne peut jamais renvoyer la requête fournisseur.

## Contrôles de préparation

Le dossier réel figé est rejoué sans permission réseau fournisseur sur les trois
branches, jusqu'à validation et sauvegarde. Les réponses de transport sont des
mocks explicites et ne sont pas des rapports IA réels. Sont aussi vérifiés :
concurrence, réveils répétés, refus d'accès, source ou citation modifiée, timeout
Luna/Sol, usage manquant, JSON invalide, verdict natif altéré et réception perdue.

Les tests SQL utilisent une transaction annulée et exclusivement des opérations
`mode=mock`. La validation de formes de consentement synthétiques est pure :
aucun de ces objets n'est passé au mécanisme d'autorisation ou enregistré.

Les identifiants du protocole scellé, sa qualification Edge et les vérifications
finales de livraison sont consignés après leur contrôle effectif.

Une première sonde ACCEPTED conserve un arrêt RPC avant Sol, compteur Sol zéro.
Le journal PostgREST confirme le code `57014` (statement timeout) pendant la
canonisation des parents. Mesure SQL isolée : 1 248,858 ms avant, 315,050 ms après
suppression de deux empreintes redondantes de parents immuables. Les empreintes
liées sont toujours comparées ; le worker calcule toujours l'empreinte complète
de l'artefact réellement chargé. Les contrôles des 78 caches et 28 réponses
natives restent inchangés. L'ancienne sonde n'est pas réactivée : une nouvelle
sonde gratuite distincte qualifie le même protocole préparé.

Le test déployé révèle aussi une différence d'environnement : les requêtes MCP
utilisent `jit=off` et un délai de deux minutes ; PostgREST utilise une limite de
huit secondes et peut activer JIT. Le journal confirme plusieurs `57014` dans le
vérificateur natif, après la première optimisation. Sur une enveloppe SQL
reproduisant l'appel RPC : 801,402 ms avec JIT, 303,091 ms avec JIT désactivé
localement dans la nouvelle fonction, sous le délai de huit secondes.
Ce réglage ne modifie ni les rôles, ni RLS, ni les autres workflows. Il reste
local à la vérification V2 et à ses appels imbriqués.
Les sondes échouées restent immuables et ne qualifient pas le protocole.

## Protocole figé

- ID : `8484a2e8-ac56-4d16-abcf-964eeb15e5d5`.
- SHA256 : `68d6c549276a278fadef49ae787bc9114bfe3b402d304b50a03bc27b5f146143`.
- Compilation : `9a28e49b68e57812b3a70d8956a3028abae6b96d`.
- Correctifs SQL de contrôle : `9cba98a` et `8a24845`.
- Worker `process-jls-restaurant` v9 actif ; bundle
  `9777d31ef8790550e183b71e898f440db5dac403e8b5813417e6f7f07491363b`.
- Les noms des trois fichiers de migration sont alignés sur les versions
  effectivement enregistrées dans Supabase.

CI : 1 823 tests dans 171 fichiers, lint, build et publication Pages réussis.
Sept tests Deno sans réseau, contrôles Deno/lint, SQL/RLS et huit cas mobiles
FR/VI (360, 390, 430, iPad 768), rechargement et aucun POST.
Les douze scénarios de panne/concurrence de la répétition hors réseau passent.

Trois sondes finales complètes ont terminé après le correctif PostgREST :

- ACCEPTED : `69a4b535-cf09-4ef9-a0e6-e1bf7b239170` ;
- REJECTED : `e76061b9-7757-48f3-bdcc-83463431a420` ;
- UNCERTAIN : `19ad959a-5041-4418-86f7-e717b2e65d3b`.

Elles sauvegardent chacune un Luna simulé, puis un Sol simulé, jamais un résultat
de fournisseur réel. Une sonde supplémentaire, `87315b7d-d8d8-4b2e-85e9-ad3311a74d7f`,
teste la validation/sauvegarde d'une réception de stress construite explicitement
en SQL : plus de 376 000 caractères et cinq recommandations synthétiques
redondantes. Elle termine `needs_review` et conserve sa réponse ; les garde-fous
ne sont pas retirés pour obtenir un résultat favorable. La sonde de stress
précédente, dépourvue d'un champ de réception typé, reste arrêtée séparément.

Ces mesures ne démontrent ni la qualité d'un futur texte Sol, ni une validation
humaine. Un futur résultat peut conserver des propositions masquées ou produire
moins de trois recommandations.

## Qualification finale et GO futur

Qualification immuable : `3e85fbc7-d487-4e27-92a3-c132a829424f`.
Les 13 mesures natives `Shutdown` correspondent aux exécutions enregistrées :

| Phase | ACCEPTED CPU | REJECTED CPU | UNCERTAIN CPU |
| --- | ---: | ---: | ---: |
| Envoi Luna simulé | 246 ms | 276 ms | 282 ms |
| Validation Luna | 290 ms | 289 ms | 309 ms |
| Envoi Sol simulé | 306 ms | 305 ms | 292 ms |
| Validation et sauvegarde Sol | 328 ms | 325 ms | 302 ms |

La validation/sauvegarde de stress utilise 380 ms CPU ; les quatre propositions
redondantes restent masquées. Mémoire native à l'arrêt : de 28 029 743 à
28 533 391 octets. Durée totale des phases : 2 348 à 11 565 ms, avec Auth et SQL.
Le CPU maximal observé laisse 1 620 ms sous la limite de 2 000 ms. Ces mesures
ne garantissent pas toute charge future ou toute sortie arbitraire.

La réception de stress mesure exactement **376 418 caractères / 377 309 octets**.
Un rectificatif technique append-only accompagne la qualification : son champ
informatif de longueur avait été copié avant le changement final du titre du
mock (écart de cinq caractères). La réception, son SHA256, les mesures CPU et
la qualification d'intégrité ne sont pas modifiés.

Relecture finale : SHA256 du protocole conforme, sources compatibles,
zéro consentement, opération payante ou tentative fournisseur. Les empreintes
des anciens runs, du résultat et de la réception Sol historiques, du cache et
des rapports Artisan sont identiques à leurs valeurs avant intervention.

Instruction possible, qui nécessitera un nouveau message humain explicite :

> GO — J'autorise Codex à exécuter une seule fois le rapport vietnamien Xóm Mới
> Garden selon le protocole 8484a2e8-ac56-4d16-abcf-964eeb15e5d5. Réutiliser les
> 78 analyses JEV et les décisions Luna exactement compatibles. Maximum une
> nouvelle requête gpt-6-luna pour la citation précise sur la boisson manquante,
> puis un seul appel gpt-6.1-sol si les preuves sont suffisantes. Aucun appel JEV
> ou Apify, aucune relance payante automatique. Si Luna rejette la preuve ou reste
> incertaine, l'exclure sans forcer la recommandation. Conserver tous les anciens
> runs et rapports. Codex assure le lancement et le suivi, sans manipulation
> GitHub ou iPhone.

Ce texte documenté n'est pas un consentement et n'est jamais transmis au
mécanisme d'autorisation par les scripts de préparation.
