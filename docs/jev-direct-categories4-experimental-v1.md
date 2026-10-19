# JEV — quatre catégories directes, variante expérimentale V1

Configuration : `jev_categories4_direct_1pass_v1`.
Jeu de questions : `categories4_direct_v1`.
Protocole de préparation : `jev-direct-categories4-chill80-v1`.

Cette variante classe directement le texte de chaque avis. Elle n'analyse pas
les 25 thèmes pour en déduire quatre catégories. Aucun résultat historique à
25 thèmes n'est réutilisé ni transformé en référence.

## Définitions exactes

| Catégorie | Périmètre |
|---|---|
| Service | Accueil, personnel, attention, attente, commandes, explications et réservations. |
| Prix | Niveau de prix, rapport qualité/prix, facture, frais et clarté des tarifs. |
| Qualité des plats | Goût, fraîcheur, cuisson, température et maintien au chaud, quantité, présentation, choix du menu et boissons. |
| Ambiance | Atmosphère, décoration, bruit, confort et propreté des lieux. |

Les clés techniques sont `service`, `price`, `quality`, `ambiance`. Leurs domaines
ne sont pas une correspondance implicite avec les anciens thèmes ou axes.
En particulier, plats et boissons appartiennent ensemble à `quality`, tandis
que la localisation géographique n'est pas automatiquement de l'ambiance.

| Classe | Sens |
|---|---|
| `positive` | Appréciation favorable uniquement dans cette catégorie. |
| `negative` | Appréciation défavorable uniquement dans cette catégorie. |
| `mixed` | Appréciations favorables ET défavorables dans cette même catégorie, éventuellement sur des facettes différentes. |
| `neutral` | Appréciation explicitement neutre ou moyenne, sans appréciation favorable ou défavorable. |
| `not_mentioned` | Aucune appréciation de cette catégorie. Les simples faits ne suffisent pas. |

L'incertitude est une abstention séparée : le sixième critère natif `uncertain`
produit `classification: null`, `status: uncertain`. Il ne produit jamais
`not_mentioned`. Un refus reconnu défensivement reste `refused`, séparé aussi.
Une réponse invalide ou manquante reste indisponible, jamais une absence d'opinion.

Les instructions complètes en anglais, critères et périmètres français exacts
sont livrés dans [la configuration JSON](jev-direct-categories4-config-v1.json).
Un test vérifie son identité avec la configuration du code.

## Règles de fidélité

- Les quatre catégories sont indépendantes. Les étoiles ne déterminent aucune polarité.
- « Good service » ne suffit que pour Service positif.
- Boissons bonnes mais lentes : Qualité positive et Service négatif.
- Personnel aimable mais service lent : Service `mixed`.
- Bons plats mais mauvaises boissons : Qualité `mixed` dans cette nouvelle taxonomie.
- Un montant ou la présence d'une taxe ne constitue pas une opinion sur le prix.
- Des frais explicitement peu clairs peuvent concerner la transparence, sans établir une erreur de calcul, une faute ou une illégalité.
- « Moyen / ni bon ni mauvais » peut être neutre. La seule absence de compliment ne suffit pas à établir une critique.
- « Pas extraordinaire » seul ne devient pas automatiquement négatif. Une appréciation favorable nuancée peut rester positive ; une ambiguïté non résolue reste incertaine.
- Négations, comparaisons, ambiguïtés, réactions du personnel, contexte mixte et résolution ultérieure sont conservés.
- Ni les symptômes rapportés ni une succession temporelle ne prouvent une causalité médicale ou une responsabilité.
- Les remarques hors périmètre ne sont pas forcées dans une catégorie. La taille du bord d'un récipient ou le choix de commander trop de plats ne juge pas automatiquement la quantité servie.

## Capacité réellement vérifiée dans le dépôt

`supabase/functions/_shared/jev.ts` fournit l'adaptateur natif TypeSafe System One :
`createJevClient().evaluatePayload`, `POST https://api.typesafe.ai/v1/systemone`,
`model`, `state`, dictionnaire de `questions`, questions `choice` avec `criteria`.
Le transport est générique : il n'impose ni 25 questions ni les anciennes polarités.

Le parseur historique `parseThemes` impose toutefois les anciennes clés et
`absent / positive / negative / both`. Il n'est donc pas utilisé. Le nouveau
parseur indépendant traite les quatre réponses et les nouveaux critères natifs.
Le format de probabilités est celui de JEV : un objet indexé par choix ; il
n'est pas remplacé par le format d'une autre API.

L'adaptation utilise quatre questions `choice`, chacune avec cinq classes et
l'abstention native `uncertain`. Il n'y a aucune demande de citation,
d'explication générative ou de texte libre. Aucun support de citations n'est
présumé. Les champs supplémentaires éventuels du brut ne deviennent pas des preuves.

Cette compatibilité est vérifiée dans le code et avec des réponses simulées.
La prise en charge effective des six critères par le fournisseur et le compte
reste **non testée en réseau**, conformément à la consigne. Aucun appel modèle,
sonde `/models`, fallback ou test de capacité facturable n'a été effectué.

## Réponses, probabilités et compteurs

Les choix natifs et réponses brutes sont conservés. Les probabilités et la
confiance natives disponibles sont conservées sans seuil ni choix par argmax.
Si elles manquent, elles restent `null` ; aucun zéro ni confiance fictive n'est
substitué. Le contrôle de somme des probabilités est seulement une validation
numérique du format, sans effet de seuil sur la polarité.

Chaque avis ne compte qu'une fois par catégorie. `mixed` contribue une fois au
positif et une fois au négatif, avec une union dédupliquée pour les avis distincts.
`neutral`, `not_mentioned`, `uncertain`, `refused` et `unavailable` restent séparés.
Les cinq classes exclusives et les états hors classement ont des compteurs
propres. Le total des avis vient de la liste unique des sources, jamais de la
somme des catégories. Les doublons ou avis hors jeu sont refusés.

Aucune précision, aucun rappel ni score qualitatif n'est calculé : il n'existe
pas de référence pour cette nouvelle taxonomie et les anciens 25 thèmes ne sont
pas une vérité de référence.

## Jeu Chill Thái figé et identité de configuration

Source en lecture seule : `public.analysis_jls_snapshot_preparations`,
`bc00633a-30d8-4a90-8e22-dcc6a0efaeb9`.

- SHA256 du protocole source : `2570b86b982ee2aed4d074d02777a2204543a89c75f056cb2601110abf5cfe1f`.
- SHA256 des 100 sources complètes : `0619b5ee7e00141dd70a7d117f67018093f6bc4fb6fb2695fa526409e94efd1c`.
- Snapshot historique : `39556285-21ee-4962-9892-da3b4f0e8ca3`.
- 80 textes anglais inchangés, avec review_id, provenance, empreinte du texte original et SHA256 du texte analytique.
- 20 identifiants sans texte conservés uniquement dans les métadonnées générales ; ils ne produisent aucune classification.

Le nouveau protocole ne contient aucune ancienne classification ni annotation.
Les textes restent dans le stockage Supabase de l'organisation ; ils ne sont
pas copiés dans la configuration publique GitHub. Le payload fournisseur contient
seulement `review_alias`, `analysis_text` et les quatre questions : ni étoiles,
ni identifiant client, ni texte original supplémentaire, ni anciennes prédictions.
Les hashes du texte, de la configuration et de la requête distinguent cette
variante des anciens caches. Aucun ancien cache à 25 thèmes n'est réutilisé.

## Exécution future et protections

Prévision technique : **80 appels JEV maximum, 320 questions, un passage par avis**.
Aucun appel supplémentaire de vérification du modèle et aucun retry ou fallback.
Le modèle demandé est `jev-latest` ; le modèle effectivement servi sera conservé
depuis chaque réponse future, sans nouvelle sonde fournisseur.

`evaluateDirectCategoriesOnce` réutilise le client existant avec `maxAttempts: 1`,
interdit les redirections et sauvegarde le brut avant le parsing. Une réservation
déjà consommée ne permet pas un deuxième envoi, même sans réponse sauvegardée.
Une erreur réseau, timeout, HTTP 429/500, réponse invalide ou perte de sauvegarde
ne provoque pas de relance. Les métadonnées d'usage manquantes ne sont pas inventées.

Cette fonction est un point d'intégration futur, sans endpoint ni transport
réseau par défaut : un worker authentifié doit fournir les contrôles de portée,
la réservation durable atomique et la sauvegarde. Aucun worker payant n'est branché,
aucun consentement ni run n'est créé pendant cette livraison. Une autorisation
future distincte et les contrôles de réservation seront nécessaires.

Aucun changement du pipeline actuel, de V11/V12/V13, des traductions, des anciens
rapports ou verdicts. Aucune interface supplémentaire et aucun développement
Luna, Sol ou recommandations.

## Reproduction sans fournisseur

1. Tests unitaires : `npm test -- --maxWorkers=2 --testTimeout=30000 tests/unit/jev-direct-categories.test.ts`.
2. Contrôles TypeScript Deno sur les trois modules et deux scripts.
3. Préparation : Deno `run --deny-net --allow-read --allow-write scripts/prepare-jev-direct-categories.ts SOURCE OUTPUT CODE_COMMIT`.
4. Rejeu technique : Deno `run --deny-net --allow-read --allow-write scripts/rehearse-jev-direct-categories.ts PREPARED QUALIFICATION`.
5. Lint et build du dépôt.

Les cas synthétiques testent les consignes, contrats, parsing et compteurs.
Les réponses mockées ne prouvent pas la qualité sémantique future de JEV.
Le rejeu réel figé teste 80 payloads, leur réservation, réception, parsing et
sauvegarde en mémoire, puis un deuxième passage sans aucun nouvel envoi.
Les sorties synthétiques sont indépendantes des textes et ne sont enregistrées
ni comme résultats JEV, ni comme annotations des 80 avis. Seule une qualification
technique explicitement identifiée peut être archivée séparément.

Le stockage expérimental utilise la table append-only existante, avec RLS par
organisation et écriture serveur uniquement, sans nouvelle table ni migration.

## Livraison figée

Dans `public.analysis_jls_snapshot_preparations` :

- Préparation : `f858bb8f-395d-4aa9-bd10-d7f641934244`.
- SHA256 de préparation : `1edf645ff5bcbb5faf731a3f21b9a95e431a4094f4c746057b126ee127650f9d`.
- SHA256 de configuration : `e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69`.
- Qualification hors réseau : `dc164448-970f-481d-8550-b7d1711ff9b1`.
- SHA256 de qualification : `8207e083ac33a150f48e31c3354dbba852e3e286b8878f41e318d28d73602d17`.
- Commit du code figé : `be626a2741faf431b16f76671f670109509fcf4d`.

La sauvegarde identique restitue le même identifiant ; aucune mise à jour ni
suppression des archives historiques n'est réalisée. La qualification ne
contient que des contrôles techniques explicitement mockés, aucun résultat
fournisseur ni annotation des textes réels.

Contrôles locaux : 62 nouveaux tests unitaires, 94 tests ciblés au total avec
les régressions de l'adaptateur, contrôles Deno, lint et build réussis. Le rejeu
des 80 payloads et son second passage ont été exécutés sous `--deny-net`.
La validation sémantique et l'audit des futures classifications restent à faire
après une autorisation et une exécution distinctes.
