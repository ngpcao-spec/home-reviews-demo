# Chill Thái — rapport fondé sur les 80 analyses corrigées

Préparation gratuite, version `jls-chill-corrected80-report-v1`.
Ce document ne constitue pas un consentement d'exécution.

## Sources exclusives et périmètre

- Classifications : `analysis_jls_snapshot_preparations`,
  `3bb12448-e34d-4484-bcca-eafe17ae1415`.
- SHA256 de cet ensemble :
  `7f0930e09bf2f7cad36e235c4892599abbbea010a979ca91eb1f6198ccd6b9bf`.
- Sources figées : protocole `bc00633a-30d8-4a90-8e22-dcc6a0efaeb9`,
  sur le snapshot historique `39556285-21ee-4962-9892-da3b4f0e8ca3`.
- 100 avis : 80 textes anglais et leurs analyses corrigées ; 20 avis sans texte,
  conservés uniquement pour les statistiques générales.
- Configuration : `v12_economy_audit_boundaries_v2_1pass_v1` ; modèle servi
  `jev-1.13.0`. Les seuils restent figés.
- SHA256 des nouveaux comptages natifs/après seuils :
  `5e4268d692fa8e8ea6a4456c9e047e65983d700ae7b0268f5946bdc0d88dc1b7`.
- SHA256 des statistiques destinées au nouveau rapport :
  `9a788cb916d0b9f9df6a7b1dfaffd5be20c451e51699459ed610f8828f2ff222`.

Aucun ancien cache V12 n'est une source de classifications pour ce rapport.
Les objets projetés en mémoire permettent seulement de réutiliser les fonctions
d'agrégation existantes ; ils ne sont pas écrits dans le cache permanent.

## Preuves et réutilisation Luna

Le sélecteur équilibré existant est réutilisé. Les 25 thèmes sont examinés.
La nouvelle préparation ajoute les propositions textuelles étroites de commande
personnalisée, publicité et frais de stationnement. Elles ne remplacent aucun
comptage JEV et doivent passer Luna avant toute utilisation par Sol.

32 preuves sont sélectionnées. 25 verdicts historiques sont exactement
réutilisables : 21 ACCEPTED et 4 REJECTED. Les verdicts rejetés restent exclus
du dossier Sol ; ils ne sont pas renvoyés à Luna.
7 nouvelles questions concernent 6 avis : **6 nouvelles requêtes maximum**,
en deçà du plafond demandé de 32. Les deux questions d'un même avis sont groupées.

Le changement des statistiques/configuration JEV n'invalide pas, à lui seul,
une vérification textuelle Luna. La compatibilité exige l'identité du texte,
de la citation, du contexte et de leurs positions, du thème, de la polarité,
de la question, du modèle et du filtre de confiance.
Les questions historiques inchangées sont conservées intégralement.

Les verdicts originaux, leurs empreintes, le groupe fournisseur d'origine et
ses sources en base sont archivés. Le rattachement technique au nouveau plan
est une liaison dérivée explicite ; il ne réécrit pas les décisions originales.
Une nouvelle citation ou une nouvelle définition ne reçoit aucun ancien verdict.

Les choix natifs, probabilités et décisions après seuils sont séparés. Une
abstention après seuil ne démontre pas l'absence textuelle du signal. Des
propositions textuelles peuvent être vérifiées sans modifier les fréquences.
Les recommandations restent facultatives : aucun thème ni nombre d'actions imposé.

## Suite du parcours, après un nouveau GO

Utiliser le protocole archivé distinct, jamais l'ancien consentement/run.
Le workflow délégué authentifié réserve les seules requêtes `pending_groups`.
Une tentative incertaine est consommée, sans retry, fallback ou vérification
supplémentaire du modèle. Les réponses natives et les probabilités sont conservées.

Une fois les décisions complètes sauvegardées, `compileCorrectedSol` est une
étape gratuite du workflow d'administration : contrôle de suffisance puis
préparation durable de la requête Sol, de ses empreintes et du certificat de
tokenisation. Cette compilation coûteuse reste hors du chemin critique Edge.

L'envoi et la validation utilisent les interfaces durables existantes
`processReadySol` / `ReadyPort` avec le contrat V2.2 compatible
`jls-recommendation-contract-v2.2-audit-boundaries`.
Le worker vérifie la requête figée et son certificat sans reconstruire le dossier.
La réponse brute est sauvegardée avant validation ; la validation est une étape
séparée. Maximum un appel `gpt-6.1-sol`, zéro JEV et zéro Apify.
Une sortie invalide reste archivée, sans appel de correction.

## Vérification gratuite reproductible

Exécuter Deno avec `--deny-net --allow-read --allow-write` :

1. `scripts/prepare-jls-corrected80.ts INPUT OUTPUT CODE_COMMIT` ;
2. `scripts/rehearse-jls-corrected80.ts INPUT PREPARED QUALIFICATION`.

Les entrées privées contiennent les sources vérifiées ; elles ne sont pas
commitées dans Git. Tous les fournisseurs sont simulés explicitement.
Les branches supported/unsupported/uncertain sont des hypothèses techniques,
jamais des résultats Luna. Le rapport simulé n'invente aucune recommandation.
Le test couvre le regroupement Luna, les empreintes, le contrôle de suffisance,
la taille de la requête Sol, sa réservation, l'envoi simulé, la réception brute,
la validation, la sauvegarde et l'absence de réémission au réveil suivant.

Le scénario simulé le plus volumineux mesure 77 745 octets, 20 652 tokens locaux,
23 387 avec marge, sous la limite d'entrée de 32 768, avec 9 500 tokens réservés
à la sortie. Ce sont des mesures de préparation, pas un usage facturé.
La taille réelle sera vérifiée de nouveau après les décisions Luna réelles.
Aucune estimation monétaire n'est produite.

Les mesures locales ne constituent pas une certification CPU de l'infrastructure
Edge. La compilation/tokenisation reste dans l'étape d'administration gratuite,
avec artefact figé avant la réservation Sol. Les étapes d'envoi/validation
simulées utilisent le certificat de tokens, sans nouvelle tokenisation.

Le protocole et sa qualification sont sauvegardés dans la table append-only
existante `analysis_jls_snapshot_preparations`, avec RLS par organisation et
écritures serveur uniquement. Aucune migration ni modification de politique
n'est nécessaire. Aucun consentement, run ou tâche payante n'est créé.

Les rapports, verdicts Luna et statistiques historiques demeurent immuables.
La vérification technique et les décisions IA ne sont pas une validation humaine.
