# Recommandations prioritaires expérimentales

Version : `jls-prioritized-recommendations-v1`, ajoutée à `jev-luna-sol-hybrid-v1`.
La préparation ne constitue aucune autorisation de dépense. Aucun fournisseur n'est appelé.

## Origine et invariants

Lecture préalable de l'audit qualitatif (événement Supabase 228), de la revalidation
`jls-quote-bound-actions-v1` (227) et du code intégré par la PR 19.
Source vietnamienne : plan `5295245f-b2c1-4f5d-80ad-ca9f821ae3da`,
run `489d42ae-c44c-40c1-8435-16f304c71a9e`.
Le rapport original, sa revalidation et les décisions Luna restent immuables.
L'ancien prompt, son schéma, le catalogue historique et le worker délégué ne sont
pas remplacés. Le nouveau format possède ses propres SHA256 et une nouvelle identité.

## Format et validation

Les quatre axes, les aspects positifs/négatifs et la conclusion sont conservés.
La conclusion est limitée à 600 caractères ; les limites figurent dans une note
serveur distincte. Recommandations : zéro à cinq, cible trois à cinq sans remplissage.

Chaque proposition contient un titre, un thème d'action, des constats attribués aux
clients, les citations exactes ACCEPTED, leur contexte et leurs empreintes, une
action proposée et une justification de priorité. Le catalogue de phrases fixes
ne s'applique pas au nouveau format. Des frontières de thèmes et de portée d'action
restent obligatoires. Le focus d'une action désigne son objet, pas une phrase imposée.

La validation réutilise les contrôles du snapshot, de Luna, des statistiques,
des citations et des actions de V3. Une règle supplémentaire, versionnée dans ce
module uniquement, reconnaît une mention explicite de frais non annoncés comme
appui à la transparence, jamais à une erreur de calcul. Une action de calcul exige
un indice explicite correspondant. Une distance ne justifie pas la signalétique ;
une attente ne justifie pas une formation.

Les omissions repérables de compensation, de réaction du personnel ou d'appréciation
mixte entraînent `review_needed`. Un résultat incomplet, une preuve incertaine/rejetée,
une source modifiée, une fréquence non fiable ou une recommandation redondante ne
devient pas une proposition affichée comme conforme. Aucun minimum de recommandations
n'est imposé et aucun appel de correction automatique n'est réalisé.

Statut favorable : `technically_bound_proposal`, jamais validation humaine ou garantie
de vérité sémantique. Une citation exacte et ses identifiants ne garantissent pas
la fidélité d'une paraphrase libre. Les tripwires linguistiques restent conservateurs
et incomplets ; l'examen qualitatif de la prochaine sortie réelle reste nécessaire.

Les comptages par thème concernent tout le périmètre JEV analysé, avec mentions,
avis distincts et dénominateur séparés. Ils ne prouvent pas la répétition d'un incident
précis. La sélection des citations ne fournit aucune fréquence de problème.

## Préparation gratuite et stockage

`buildPrioritizedDraft` valide les verdicts natifs existants et ne retient que les
preuves ACCEPTED. `validatePrioritizedReport` valide une future sortie structurée.
Le script administratif `scripts/prepare-jls-prioritized.ts` n'a ni accès réseau
ni client fournisseur. Il vérifie le plan et le snapshot avant de préparer FR/VI.

Les artefacts sont ajoutés au journal immuable `analysis_jev_luna_sol_events`,
action `prioritized_report_format_prepared_v1`, avec SHA256 de source, configuration,
dossier, prompt, schéma et requête. L'index partiel garantit une identité unique par
organisation, plan et langue. La RPC `save_jls_prioritized_preparation` est réservée
au rôle serveur ; les lectures héritent de la RLS owner/admin/manager du journal.
Elle ne crée ni run, ni tâche, ni consentement. Le GET authentifié ne fait que lire
et vérifier la préparation, ou la calculer gratuitement si elle n'est pas archivée.

## Futur essai

Les anciennes autorisations et l'ancien run terminal ne sont jamais réutilisables
pour lancer cette nouvelle requête. Le format n'est pas raccordé à un endpoint de
dépense pendant cette livraison. Un GO explicite futur nécessitera un nouveau
protocole d'exécution lié aux SHA256 du nouveau format et une identité de run distincte,
en réutilisant les réservations durables existantes : maximum un Sol, plafonds Luna
conservés, aucune répétition ni retry payant. Aucune configuration commerciale n'est activée.

Sur les verdicts existants exactement compatibles : JEV supplémentaire zéro,
Luna supplémentaire zéro, 24 preuves ACCEPTED, une REJECTED exclue.
Estimation locale du nouvel appel Sol FR/VI : 19 862 tokens d'entrée,
4 340 de sortie prévue, 0,083124 USD ; scénario haut de sortie à 9 500 tokens :
0,134724 USD. Tarifs enregistrés : entrée 2 USD / million, sortie 10 USD / million.
Ces valeurs ne sont pas des tokens facturés ni une facture ; suppléments non vérifiés.

## Exemple entièrement synthétique

Titre : Suivre les délais de service.
Constat : un client rapporte une longue attente sur la terrasse ; le serveur a
ensuite présenté des excuses et proposé une remise.
Action proposée : examiner le suivi des commandes sur la terrasse, en tenant
compte de la prise en charge ultérieure.
Preuve : identifiant synthétique rattaché à une citation et son contexte exacts.
Priorité : ce délai décrit par un client est un point concret à vérifier,
sans extrapoler une fréquence ou prétendre que l'action est une solution validée.

## Contrôles

Tests synthétiques Vitest et Deno sans réseau, contrôles SQL en transaction annulée
(RLS, immutabilité, idempotence et falsification), lint et build.
Playwright FR/VI : iPhone 360/390/430 et iPad 768, ouverture des preuves,
rechargement, zéro débordement et zéro requête fournisseur.
L'affichage des rapports historiques est testé séparément et conservé.
