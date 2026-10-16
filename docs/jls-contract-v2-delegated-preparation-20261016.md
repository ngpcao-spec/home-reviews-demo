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
Ce réglage n'affecte ni les rôles, ni RLS, ni les autres fonctions/expériences.
Les sondes échouées restent immuables et ne qualifient pas le protocole.
