# Classement IA des plats HOME Reviews

Le menu texte Rainminer reste la source. La nouvelle migration
`20261125141350_classify_saved_menus_with_ai.sql` prépare une file séparée,
désactivée par défaut, sans mettre les anciens menus en file. Le déclenchement
réutilise la fin d'import, la réutilisation d'un menu et les droits actuels.

Le serveur calcule une empreinte du menu utile, dans son ordre d'origine.
L'identifiant Google, l'empreinte, le modèle et la version du contrat identifient
une demande unique. Les dates du run et les URL des photos ne changent pas
l'empreinte. Le cache est commun pour le même établissement Google. Les
associations et preuves restent publiées dans la portée autorisée du compte.
Le modèle se règle côté serveur dans `private.menu_dish_ai_settings.model`.
L'Edge Function Rainminer reçoit une action Cron dédiée via le jeton serveur
existant. Les lectures de fiche et les recherches ne lancent aucun classement.

Le contrat `menu-dish-ai-v6` traite en priorité la spécialité. Le serveur
vérifie les lignes sources, y compris leurs rubriques. Une spécialité peut
être retenue quand le nom du restaurant concorde avec le menu ou quand le
profil spécialisé est étayé par des preuves liées au même plat. Elle devient
alors recherchable avec ou sans accents. Si elle reste indéterminée, la fiche
indique « Spécialité à confirmer » après un classement réussi.

Le serveur vérifie chaque citation. Une référence absente, dupliquée ou
imprécise est consignée avec son motif et ne retire pas les autres preuves.
Une ligne qui désigne une boisson, un supplément ou un plat distinct laisse
la spécialité à confirmer si elle est citée comme preuve pour la spécialité
proposée. Sans preuve suffisante, la spécialité reste aussi à confirmer.
Le texte brut reçu sur une réponse HTTP réussie reste dans le stockage privé
des traitements, avec le résultat validé et les motifs de rejet.

Le profil de la carte (`menu_profile`) et le type de restaurant
(`restaurant_type`) sont conservés séparément avec leurs citations. La fiche
affiche les valeurs localisées du résultat publié, y compris lorsqu’un
nouveau classement est en cours ou échoue. Le type de restaurant
n'intervient pas dans la validation de la spécialité.

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

Le rejeu local utilise les réponses OpenAI intactes de Bún Bò Hương Giang,
du scénario contrôlé au nom neutre, de Bánh Căn Tháng Năm et de Green Home.
Lancer `npx --no-install vitest run artifacts/menu-dish-ai-v6-validation/live-replay.test.ts`
depuis le checkout qui détient les reçus. PGlite exécute la publication et la
recherche SQL. Les captures mobiles utilisent les résultats SQL rejoués
comme réponses locales aux lectures de l'interface, avec
`npx --no-install playwright test --config artifacts/menu-dish-ai-v6-validation/playwright.config.ts`.

Lors d'un déploiement autorisé, appliquer la migration de classement en
attente, puis publier la fonction `rainminer-menu` avec son helper
`menu-dish-ai.ts` et le client de la même branche. Contrôler le contrat v6 et
laisser le classement désactivé lors de la vérification de la migration.
Le rejeu local et cette migration ne déclenchent aucun retraitement des menus
existants.

Après les contrôles, renseigner `enabled_since` avec l'heure d'activation
et passer `enabled` à `true` dans la même transaction. Une réutilisation
d'un menu antérieur ou une extraction au contenu utile identique à une
version antérieure à l'activation ne crée pas de tâche IA. Un classement
déjà publié et compatible reste réutilisable. Le retour arrière opérationnel
consiste à remettre `enabled` à `false` sans retirer les résultats publiés.

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
