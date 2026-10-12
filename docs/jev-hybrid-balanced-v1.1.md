# Sélecteur hybride V1.1 équilibré — préparation gratuite

Configuration indépendante `jev-hybrid-evidence-report-v1.1-balanced`, sur le snapshot Artisan `f9c8876b-1b5a-4d10-9538-758881b61b6b`. Aucun nouveau JEV, Sol, OpenAI API ou Apify ; aucun rapport, aucune autorisation et aucun job payant. La V1, ses deux plans, les 422 analyses et tous les audits restent inchangés.

## Architecture

`jev-hybrid-balanced.ts` réutilise l'audit du cache, les agrégats, les candidats et le contrat Sol V1 sans modifier `jev-hybrid-evidence.ts` ni V3. Il propose des phrases exactes liées au thème, à l'entité et à la polarité, avec contexte, offsets UTF-16, SHA256, provenance et résultat JEV conservés. Le texte complet des avis sélectionnés reste consultable sans être envoyé systématiquement à Sol.

La première étape couvre les critiques précises 1★, plusieurs exemples des principaux problèmes, les erreurs de commande/facturation/hygiène disponibles, les axes et polarités. La seconde diversifie les exemples, notamment 4–5★. Les objectifs 3 citations 1★ et environ 40 % de citations 1–3★ sont conditionnels. Ils ne rendent jamais une preuve admissible. Le manque d'extraits ou de budget est enregistré. Deux citations au maximum par avis ; les quasi-doublons sont écartés. Les scores et comparaisons de citations sont mémorisés durant la sélection pour éviter des calculs identiques répétés.

Le nouveau dossier conserve les empreintes et informations nécessaires à la vérification, réduit les métadonnées répétées et est recomposé lorsque le budget impose moins de citations. Plafond d'entrée inchangé : 20 000 tokens estimés, avec une cible de 16–32 citations. Le futur appel Sol unique devra vérifier toutes les preuves, y compris celles confirmées par règle.

Le filtre reste déterministe et limité. Un compliment général n'établit pas la compétence ; une difficulté linguistique ne prouve pas automatiquement un manque d'attention ; une boisson n'établit pas la qualité des plats. « Bot expensive » reste ambigu. Le choix d'un mauvais plat par le client ne prouve pas une erreur de commande ; une substitution ou un élément manquant explicitement décrits peuvent en revanche la justifier. Distance et difficulté de repérage restent distinctes. Les contrastes et corrections ultérieures restent dans le contexte. Une plainte sur un steak ne devient pas une plainte sur tous les plats. Les symptômes restent des déclarations du client, jamais une causalité médicale établie.

## Résultats gratuits sur le même snapshot

Les statistiques JEV restent calculées sur 422 avis : Qualité 78 mentions négatives / 51 avis, Prix 77 / 44, Service 55 / 19. Ces comptages JEV ne sont pas une validation sémantique ou humaine.

| Indicateur | V1 | V1.1 |
|---|---:|---:|
| Citations | 23 | 25 |
| Avis distincts | 19 | 24 |
| Citations 1★ | 0 | 3 |
| Citations 2★ | 2 | 3 |
| Citations 3★ | 2 | 5 |
| Citations 4★ | 6 | 3 |
| Citations 5★ | 13 | 11 |
| Critiques issues de 1–3★ | 0 | 9 |
| Critiques issues de 4–5★ | 17 | 6 |
| Thèmes distincts | 19 | 14 |
| Couples thème/polarité | 23 | 19 |
| Confirmées par règle | 12 | 25 |
| Candidates Sol sélectionnées | 11 | 0 |
| Citations d'avis mixtes | 23 | 22 |

11/25 citations proviennent d'avis 1–3★, soit 44 %. Les trois citations 1★ concernent des avis différents : nourriture sans goût (`9f65e579…`), difficulté de communication (`17bbc7c2…`), viande explicitement trop cuite (`dd36b8be…`). Les principaux sujets disposent de preuves négatives distinctes : Qualité 6, Prix 4, Service 4. La sélection privilégie ces exemples au nombre maximal de thèmes différents.

| Axe | Positives V1.1 | Négatives V1.1 |
|---|---:|---:|
| Service | 2 | 4 |
| Qualité | 6 | 6 |
| Prix | 1 | 4 |
| Ambiance | 1 | 1 |

La nouvelle présélection contient 487 associations confirmées par règle, 975 candidates Sol et 118 contestées. Les 118 restent exclues. 627 associations non contestées ne fournissent pas d'extrait suffisamment rattaché au thème pour cette sélection ; cela ne les transforme pas en faux findings JEV. Deux associations du même avis « Bot expensive » sont déclassées en candidates et ne sont pas retenues. Les 25 confirmations sélectionnées sont des propositions déterministes, pas une validation humaine ou IA indépendante.

22 citations V1 sont retirées ou reformulées, avec une raison par association dans le plan ; 22 nouvelles associations sont sélectionnées, deux extraits de couples conservés sont précisés, une citation reste identique. Les motifs distinguent ambiguïté, rattachement insuffisant, précision de l'extrait et arbitrage priorité/diversité/budget. Aucune contestation explicite n'est réintroduite. La diversité du dossier n'est pas sa représentativité statistique.

## Coûts et empreintes

Tarifs persistés : entrée Sol 2 USD/million, sortie 10 USD/million. Tokeniseur local et marge V1 inchangés ; aucune estimation n'est présentée comme consommation mesurée.

| Dossier | Octets JSON | Entrée estimée | Sortie estimée | Sol estimé | Estimation haute (9 500 sortie) |
|---|---:|---:|---:|---:|---:|
| V1 FR | 56 017 | 19 862 | 4 779 | 0,087514 USD | 0,134724 USD |
| V1.1 FR | 54 524 | 19 636 | 4 828 | 0,087552 USD | 0,134272 USD |
| V1 VI | 56 310 | 19 994 | 4 779 | 0,087778 USD | 0,134988 USD |
| V1.1 VI | 54 817 | 19 768 | 4 828 | 0,087816 USD | 0,134536 USD |

Sur VI, +0,000038 USD estimé ; cette différence ne vaut pas autorisation. Coût réel supplémentaire : zéro. Les SHA256 du sélecteur/configuration, fichier source, dossier, prompt et schéma sont enregistrés séparément. Empreinte du fichier : `9a7bf46772a3902e55039d60aaf0d101b747d6e66b8ab9fd2516ed81bcac29b3`.

Plans immuables FR `7738cf5c-d299-46ca-b2ea-40a594f2966a`, VI `71e46e6f-0c95-4d0e-840f-618c3f66e85d`. Les tables hybrides existantes sont réutilisées avec un versionnement explicite et une RPC gratuite distincte, réservée au serveur. Les rôles owner/admin/manager de la même organisation peuvent lire les plans. Aucune écriture directe authentifiée ni autorisation de dépense n'est ouverte. Les fonctions de lancement payant restent fermées.

## Accès et validation

Plus / Thêm → Test Jev → Rapport hybride JEV + Sol → Sélection V1 ou Sélection V1.1 équilibrée. Comparaison, étoiles, axes/polarités, coûts, remplacements, ambiguïtés, citations et textes complets. Le choix de sélection persiste après rechargement. Bouton de génération désactivé.

Tests : 1 393 cas unitaires vérifiés, avec relance isolée de l'ancien test Gold dépassant son délai sur la machine ; régression ciblée après optimisation, 25 nouveaux cas du sélecteur et vérifications API/worker/écran. Tests Deno avec réseau interdit, lint et types Deno, SQL/RLS en transactions annulées (V1 et V1.1), lint et build frontend. FR/VI sur 360/390/430 et iPad 768 : zéro overflow, reprise et génération désactivée, aucune requête fournisseur. Les fixtures navigateur sont explicitement des données de test préconstruites ; elles ne calculent pas le sélecteur sur le téléphone et ne contiennent aucune réponse Sol fictive.

Les anciennes appréciations GPT-6 ne sont pas une nouvelle validation indépendante. La présente livraison est une préparation expérimentale gratuite ; la génération réelle reste soumise à une future autorisation spécifique et à l'ouverture contrôlée du connecteur.

Le contrôle d'intégrité global a relevé une évolution de l'empreinte de la table live `reviews` pendant la mission, sans opération de cette livraison sur cette table. La vérification du périmètre Artisan confirme 523 identifiants toujours présents, zéro modification des textes originaux et zéro modification des étoiles. Les snapshots, analyses, traductions, audits et anciens plans contrôlés restent identiques. Le nouveau dossier utilise exclusivement le snapshot figé et ne reprend pas des données live.
