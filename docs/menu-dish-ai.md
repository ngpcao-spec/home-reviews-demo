# Classement IA des plats HOME Reviews

Le menu texte Rainminer reste la source. La nouvelle migration
`20261125051909_classify_saved_menus_with_ai.sql` prépare une file séparée,
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

Le résultat doit couvrir chaque ligne du menu une seule fois. Une ligne déjà
identifiée comme boisson ne peut pas devenir un plat. Les noms, variantes et
preuves sont enregistrés dans les associations existantes. La spécialité doit
être appuyée par les lignes citées et par le nom du restaurant. Les données
brutes, les corrections et les suppressions manuelles sont conservées. Une
réponse invalide, un échec ou une tentative au résultat inconnu ne déclenche
pas une deuxième requête. La fiche et les résultats de recherche indiquent
quand les associations proviennent du menu précédent.

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
**0,00438 USD**, ou **0,00813 USD** avec les 3 000 tokens de sortie autorisés
par demande et le nombre estimé de tokens d'entrée. Le coût réel dépend du
comptage fournisseur. [Tarif officiel](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

Relire notamment Bún bò, Bún bò giò, les lignes incertaines Đặc biệt et
Bò (gân), les variantes d'œufs de Bánh căn et les boissons. Les tests
simulés valident l'intégration et la conservation des données. La qualité
du classement réel reste à mesurer sur ces réponses.
