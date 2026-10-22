# Couverture négative et avis mixtes — sélection expérimentale

Version : `jls-direct4-negative-mixed-coverage-v1`.
Empreinte du sélecteur : `17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e`.

Le sélecteur précédent pouvait remplir sa limite de deux associations par avis
avant d'avoir couvert une catégorie négative. Il pouvait également retenir une
seule polarité d'une classification mixte. Le dossier contenait le texte complet
mais pas les références autorisant la synthèse à reprendre ces autres opinions.

La nouvelle version réutilise l'ordre de préférence du sélecteur équilibré.
Elle réserve d'abord au moins une association négative par catégorie disponible.
Une classification mixte est sélectionnée en un bloc positif/négatif insécable.
La diversification complète ensuite le dossier, toujours dans la limite de 32
associations. Les sources proches restent évitées en diversification ; elles ne
peuvent pas supprimer la seule couverture négative disponible d'une catégorie.

La limite habituelle de deux associations par avis admet une exception explicite
pour la couverture obligatoire et les paires mixtes. Les exceptions et les manques
(catégorie, identifiants candidats, budget insuffisant ou paire indisponible)
sont enregistrés dans `selection.coverage_diagnostics`. Aucun classement n'est
créé ou corrigé. Un avis reste transmis une seule fois par le format compact.

## Compatibilité

Les futurs protocoles `jls-direct4-parallel-no-luna-v1` portent une identité
`configuration.evidence_selector` avec sa version et son SHA256. Le worker
vérifie cette identité. Les protocoles sans cette option conservent le sélecteur
historique. Le prompt court JEV, les statistiques, le modèle et le raisonnement
Sol, le prompt compact, le schéma et la reconstruction des références ne changent
pas. Les anciens rapports ne sont pas resélectionnés. La production Sol seule et
les règles de vérification Luna restent inchangées.

## Rejeu hors réseau du 22 octobre 2026

Les sélections historiques ont d'abord été reproduites à l'identique, puis la
nouvelle option a été appliquée aux mêmes classifications natives et sources.

| Archive | Associations avant/après | Avis distincts avant/après | Groupes mixtes incomplets avant/après | Associations remplacées |
| --- | --- | --- | --- | --- |
| 80s Bistro `cb766e89-178e-454a-9c4d-f09f248837f9` | 32 / 32 | 22 / 14 | 8 / 0 | 8 |
| Foursea `ad6ae47b-185d-4845-bbb4-d4f0a657540f` | 32 / 32 | 24 / 23 | 5 / 0 | 5 |
| Nha Trang xưa `dd6ddeec-77a9-47eb-a3f3-f5235e778f8b` | 32 / 32 | 23 / 22 | 1 / 0 | 1 |

Nombre d'associations positives / négatives (ce ne sont pas des statistiques du corpus) :

| Établissement | Service avant → après | Prix avant → après | Qualité avant → après | Ambiance avant → après |
| --- | --- | --- | --- | --- |
| 80s Bistro | 6/3 → 5/4 | 3/2 → 3/2 | 6/7 → 8/6 | 5/0 → 3/1 |
| Foursea | 5/5 → 7/4 | 3/4 → 2/4 | 5/4 → 6/4 | 5/1 → 4/1 |
| Nha Trang xưa | 7/1 → 6/1 | 1/4 → 1/4 | 6/6 → 7/6 | 7/0 → 7/0 |

Chaque catégorie disposant d'une classification négative exploitable est
couverte. Nha Trang xưa n'a pas de candidat d'ambiance négative : aucune preuve
n'est fabriquée pour en remplir une case. Les statistiques de couverture restent
respectivement 68/100, 87/100 (4 résultats techniques manquants et 9 sans texte),
et 75/135. Le dénominateur des classifications reste le nombre de résultats
disponibles, jamais le nombre de citations choisies.

L'avis Bistro `66baf0a7-489b-43b7-87cc-4a21ab042936` dispose maintenant de
`ambiance:negative`, `service:positive`, `service:negative`, et des deux polarités
`quality` de son classement JEV mixte. Sa classification n'est pas corrigée à la
main. Le classement erroné concernant le savon reste également conservé.

Le compromis est une moindre diversité d'avis distincts, surtout pour Bistro,
car les appréciations mixtes occupent deux références. Le plafond n'augmente pas.
Cela n'implique aucune représentativité statistique des citations sélectionnées.

## Vérification

Tests synthétiques : couverture avant diversification, paires indivisibles,
budget insuffisant explicite, paire manquante, doublons, intégrité des choix
natifs, ordre déterministe, plafond et compatibilité des anciens protocoles.

Rejeux réels avec Deno `--deny-net` et `fetch` interdit : vérification des sources
et réponses JEV sauvegardées, mêmes empreintes de statistiques et candidats,
absence de mutation, limite de 32, un texte par avis dans le compact, reconstruction
exacte des citations et empreintes des 96 associations, rejet d'une référence
inconnue et contrôles du rapport sur des réponses **explicitement simulées**.

Le rejeu vérifie le dossier transmis et les contrôles techniques. Il ne démontre
ni la justesse des classements JEV ni la qualité d'une future rédaction Sol.
Aucun appel fournisseur, aucun consentement, aucun run payant ni aucune
régénération n'est nécessaire pour ce correctif.
