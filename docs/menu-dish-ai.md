# Classement IA des plats HOME Reviews

Le menu texte Rainminer reste la source. La nouvelle migration
`20261125141350_classify_saved_menus_with_ai.sql` prépare une file séparée,
désactivée par défaut, sans mettre les anciens menus en file. Le déclenchement
réutilise la fin d'import, la réutilisation d'un menu et les droits actuels.

Le serveur calcule une empreinte du menu utile, dans son ordre d'origine.
L'identifiant Google, l'empreinte, le modèle et la version du contrat identifient
une demande unique. Les dates du run et la résolution des photos ne changent
pas l'empreinte. Lorsque le classement utilise une photo, son identifiant
source et les lignes associées font partie de l'empreinte. Le cache est commun
pour le même établissement Google. Les
associations et preuves restent publiées dans la portée autorisée du compte.
Le modèle se règle côté serveur dans `private.menu_dish_ai_settings.model`.
L'Edge Function Rainminer reçoit une action Cron dédiée via le jeton serveur
existant. Les lectures de fiche et les recherches ne lancent aucun classement.

Le contrat `menu-dish-ai-v12` confie le choix du nom de la spécialité et sa
provenance au modèle. Le serveur vérifie le format, les références existantes
et les exclusions explicites du menu. Les références écartées sont
journalisées. Une proposition sans preuve exploitable garde son nom et
s’affiche avec une source non vérifiée. Seules les associations étayées par
des lignes sont intégrées à la recherche des plats du menu.

Une proposition d’après le nom cite un fragment de l’enseigne. Elle nécessite
une preuve indépendante du type street food. Elle reste distincte des lignes
de menu et des corrections manuelles. Helpeat la reçoit comme suggestion
avec disponibilité non vérifiée, sans prix, variante ni garniture déduits.

Quand les lignes alimentaires sont dépourvues de rubriques, le worker peut
transmettre une seule photo Rainminer déjà associée au menu. En cas de photo
inaccessible, le worker envoie le menu texte. La réponse brute et les preuves
restent dans le stockage privé des traitements.

Le profil de la carte et le type de restaurant sont conservés séparément
avec leurs citations. La fiche affiche le résultat publié pendant un nouveau
classement ou après un échec. Une proposition d’après le nom ou à source non
vérifiée est affichée pour le traitement courant. Les modifications manuelles
restent prioritaires.

Un type positif doit citer des lignes existantes et admissibles du menu.
Le modèle choisit le type, y compris une offre familiale déduite de plusieurs
plats distincts. Le validateur contrôle les références sans interpréter à
nouveau la carte ni imposer de formule familiale.

Un plat secondaire doit être nommé en toutes lettres dans la ligne et
figurer dans un contexte compatible avec un plat autonome. Une appellation
générique telle qu'une taille, un assortiment sans contenu nommé ou une
option reste dans « Autres », comme les lignes des rubriques de suppléments
et garnitures. Un qualificatif reste permis dans le nom complet d'un plat.
Ces décisions sont indépendantes de la spécialité. Les boissons et articles non alimentaires
identifiés sont exclus de la recherche. Le serveur classe chaque ligne
conservée, garde son original et respecte les corrections et suppressions
manuelles. Un échec ou une tentative au résultat inconnu ne déclenche pas une
deuxième requête. La fiche et les résultats de recherche indiquent quand les
associations proviennent du menu précédent.

## Vérification du correctif avant déploiement

Le rejeu local lit les archives de réponses sans fournisseur. Exécuter
`npm exec --no -- vitest run artifacts/menu-dish-ai-v11-live/replay-v12.test.ts --maxWorkers=1`
depuis le checkout qui contient les reçus et la migration Helpeat. PGlite
exécute les migrations, la publication et la projection du catalogue en
environnement isolé. Le rejeu vérifie la conservation des décisions archivées.
La qualité du prompt v12 nécessite un essai réel distinct.

La migration `20261128082838_ai_specialty_choice.sql` suit la migration v11
`20261128082837_name_based_restaurant_specialty.sql` et requiert une file vide.
Elle suspend les nouvelles réservations et conserve les résultats déjà
publiés. Déployer le worker `rainminer-menu` compatible v12 pendant cette pause.
La migration Helpeat `20261128082830_helpeat_name_specialty_candidates.sql`
et les clients compatibles exposent la provenance avant l’activation.

Après les contrôles, définir `model='gpt-5.4-mini-2026-03-17'`, renseigner
`enabled_since` avec l'heure d'activation et passer `enabled` à `true` dans la
même transaction. Le worker utilise l’effort `low` du pilote. Une réutilisation
d'un menu antérieur ou une extraction au contenu utile identique à une
version antérieure à l'activation ne crée pas de tâche IA. Un classement
déjà publié et compatible reste réutilisable. Pour revenir à v10, suspendre
les réservations, laisser finir les tâches en cours, rétablir le bundle
`rainminer-menu` et les fonctions SQL sauvegardées, puis réactiver avec
`gpt-5.4-nano-2026-03-17`. Conserver les résultats et les preuves publiés.

## Essai sur deux menus sauvegardés

Avec Node 22 ou plus récent, exécuter
`node --experimental-strip-types scripts/test-menu-dish-ai.mjs` depuis la
racine. Cette commande estime le coût localement.

Après validation du coût, le même script avec `--live` traite uniquement les
copies sauvegardées de Bún Bò Hương Giang (12 lignes) et Tiệm Bánh Căn Tháng Năm
(16 lignes). Il utilise l'accès OpenAI déjà configuré dans l'environnement
isolé et enregistre les réponses validées dans
`artifacts/menu-dish-ai-pilot/`. Le script ne se connecte ni à Supabase ni à
Apify. Un reçu local est réservé avant chaque appel. Un échec interrompt
l'essai et le reçu empêche de relancer automatiquement un appel incertain.

Modèle proposé : `gpt-5.4-nano`. Estimation pour deux appels :
**0,00462 USD**, ou **0,00837 USD** avec les 3 000 tokens de sortie autorisés
par demande et le nombre estimé de tokens d'entrée. Le coût réel dépend du
comptage fournisseur. [Tarif officiel](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

Les tests simulés utilisent les menus sauvegardés pour vérifier les
spécialités Bún bò et Bánh căn, leurs preuves, la recherche sans accents,
la rubrique « Autres » et les exclusions. Les réponses archivées de l'ancien
contrat ne contiennent ni profil de carte ni type de restaurant. Le nouveau
schéma et les deux champs supplémentaires se vérifient avec des réponses
simulées.
