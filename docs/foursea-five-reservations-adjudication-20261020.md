# Foursea : cinq réservations sans envoi fournisseur

Préparation uniquement. Aucun consentement, run payant, appel fournisseur ou
réouverture historique. Les classifications et consignes ne changent pas.

## Conclusion technique

Les cinq tâches du run `ad64447b-cc9e-4f22-852b-63f43a1564f0` sont classées
`certainly_not_started`. Il s'agit d'une conclusion sur le chemin logiciel,
fondée sur le code et les transactions, pas d'une attestation de facturation.

| Tâche | Avis | Réservation UTC |
| --- | --- | --- |
| 905fb59e-e6a5-4235-acd3-8c04e0466748 | 7d4227a9-a7b7-485e-82fa-b5a88181e5b6 | 02:54:35.646507 |
| a5ae5f84-a385-486d-86f5-d9e7d1c375ca | 7ed24850-cb44-49a8-ae4c-ca471adecaf3 | 02:54:39.535391 |
| 36889e31-165f-432d-909c-5122ce18d9d6 | 8023e0f0-7c4c-45df-b465-87fa7dc9050b | 02:54:43.441313 |
| c7b58a0e-e5d6-456c-8587-5fb4deae19d0 | 8089522e-8020-41ec-8add-bdc08e9508b0 | 02:54:47.631640 |
| 6e3776cb-1e9a-4539-800c-f74921a908f7 | 811a951e-115f-4548-bbe3-b501ce5c697a | 02:54:51.781781 |

Le bundle v28 effectivement déployé avait pour SHA
`994a86713e8239f07b8f0390ffdbdf6d7055f368990a06ed9fb8a2477256125b`.
Le chemin `processHistoricalDirect4Run → processRestaurant` attendait les
huit réservations SQL séquentielles avant de commencer le `map` contenant
`restaurantAttempt`, seul site d'envoi JEV de ce parcours. L'erreur SQLSTATE
57014 de la sixième réservation, à 02:55:05.031 UTC, remonte immédiatement
du port Supabase et saute ce `map`. Les cinq transactions précédentes sont
commises ; la sixième échoue. Réserver n'est donc pas envoyer.

Les cinq tâches portent le même worker et le même bail. Le verrou du run
et le bail empêchent un autre worker d'entrer pendant ce lot ; les tâches
`running/request_count=1` ne sont jamais réservées de nouveau. Le chemin
d'entrée exclut le run terminal au réveil suivant. Les RPC de réservation
n'effectuent aucun HTTP fournisseur. Les traces identifient les deux
invocations v28, le timeout et le run arrêté ; l'absence de reçu n'est pas
utilisée comme preuve suffisante à elle seule.

Le rejeu **sans réseau** du worker v28 sauvegardé produit six appels au
port de réservation et zéro invocation du transport simulé quand la
sixième réservation échoue. Le témoin, où cette réservation termine
normalement la boucle, atteint cinq transports simulés. Un second réveil
concurrent est refusé. Ces mocks vérifient le contrôle de flux, jamais le
comportement réel d'un fournisseur.

Preuves et justification immuables dans `analysis_jls_snapshot_preparations` :
`f162a09b-a717-4b5e-ab0c-3dc2b34a81b1`, SHA
`36d60f8e94d02dfc9264dde3be9caed54dd7eaf7d0c33a38816a9dcacda96189`.
Le diagnostic antérieur `49d0a50a-3c22-4e6b-bc1f-4971ec0c2462` reste intact.

## Admissibilité et protection contre les doublons

`analysis_jls_nondispatch_adjudications` lie immuablement cette preuve aux
empreintes du run, des 51 tâches et des cinq requêtes. La lecture est limitée
aux responsables de l'organisation ; les écritures sont réservées au serveur.
`record_jls_nondispatch_adjudication` contrôle le statut arrêté, les tâches,
les sources et le dossier de justification. Les gardes de sources certifiées
figent aussi le run arrêté et ses tâches, sans les modifier.

Le nouveau manifeste conserve la continuation partielle existante et ajoute
un rattachement `jls-nondispatch-adjudicated-v1`. Le contrôleur SQL compare
intégralement ce manifeste au protocole précédent, sauf cette liaison et la
provenance de code. Un index unique autorise un seul successeur du run
adjudiqué. Un changement de preuve, de requête, de corpus ou l'ajout d'une
ancienne issue inconnue échoue. La fonction publique conserve son OID pour
que les appels SQL déjà compilés ne contournent pas cette garde.

Le worker **v31 reste inchangé** : certificat de sources, bail, réservation
atomique, intention d'envoi unique, reçus et sauvegardes idempotentes. Les
reprises de persistance n'effectuent pas de nouvel appel fournisseur.

## Protocole préparé

`98de5579-967f-4f20-841b-d8e6e6f1f75e`, SHA
`94d94f5db0619d6e1aa8df1802e8b86f1dbf6dd54f44927c44918a2f657fbc11`.
Certificat : `c29b561c8fa168e835dc31b24e9f651fc7fd99e45e3a41ba57db0f9a67f85b00`.

- Corpus conservé : 100 avis, dont 91 textuels et 9 sans texte.
- Résultats réellement disponibles : **36**.
- Premières exécutions futures admissibles : 46 jamais réservées + 5
  réservées sans envoi démontré, soit **51**.
- Quatre anciennes issues inconnues exclues, avec textes conservés ; aucun
  résultat, token ou usage inventé.
- Maximum possible après exécution : **87**, jamais présenté comme acquis.
- Plafonds : **51 JEV**, **32 requêtes Luna** regroupées par avis, **1 Sol**
  si les preuves suffisent, **0 Apify**, aucun retry fournisseur.

Un futur GO spécifique à ce protocole est nécessaire. Aucune autorisation
historique n'est réactivée. La synthèse reste V1.1 et les quatre catégories
gardent exactement les définitions et six choix existants.

## Vérifications

Rejeu v28 sans réseau ; parcours complet Deno v31 avec 51 réponses JEV,
Luna et Sol explicitement simulés jusqu'à réception, validation et sauvegarde.
Qualifications gratuites sur les quatre étapes du worker **déployé v31**
pour ce nouveau protocole. Les simulations ne sont pas de nouveaux résultats.

Test transactionnel SQL/RLS : preuve et protocole idempotents, refus d'un
second successeur, de preuves altérées et du reclassement des anciennes
issues inconnues ; historique et adjudication immuables ; lecture owner,
refus interorganisation et écriture client refusée. Les 51 réservations,
intentions et sauvegardes simulées passent via les RPC existantes, sous la
limite SQL inchangée, puis la transaction est annulée.
