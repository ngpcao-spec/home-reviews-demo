# Xóm Mới Garden — deuxième essai délégué

Protocole : `jls-restaurant-delegated-vi-v1`. Expérimental, hors rapports commerciaux.
Identifiant enregistré : `34b5a197-b1a6-42e2-b048-e955f1ef8281`.
SHA256 du protocole : `cd0c55f006608230bf7429e86bff8369fb5877f95886401c5a922d7bab509da4`.
SHA256 du snapshot : `ee06d5dbbf26fbd897167e526793c93af31cc993487dfb36ffd75d4274609d55`.
SHA256 de configuration : `32c42a3f3cfbb4748154f9c941a54f5883068be01c73f7a7df2d810ce940f2e2`.
Cette livraison prépare le test et ne constitue aucune autorisation de dépense.
Aucune estimation monétaire ni confirmation d'un montant.

## Périmètre vérifié et figé

Établissement `d40d3438-79d8-4c28-8b09-eba640598201`, organisation propriétaire
`93228bbb-6397-41e3-b8be-21ee7060eda7`. Capture serveur du 14 octobre 2026.
17 038 avis annoncés Google ; 587 stockés ; 550 avec texte ; 37 sans commentaire.
78 textes anglais réellement disponibles via le résolveur existant :
33 originaux anglais et 45 traductions anglaises. Pas de fallback non anglais.
472 commentaires ne disposent pas d'anglais ; aucun backfill ni import.

7 caches V12 économiques exactement compatibles sur les 78 avis sont figés.
Le huitième cache économique n'a pas de texte anglais disponible dans ce
périmètre ; un cache compact est exclu. 71 avis nécessiteraient JEV.
Identité : organisation, établissement, review ID, SHA256 anglais, instructions,
seuils, configuration, modèle demandé et modèle réellement servi.
Les réponses complètes des 25 thèmes et leurs résultats dérivés sont vérifiés.

## Une exécution future seulement

Après un nouveau GO explicite : au plus 71 appels JEV, un passage par avis,
concurrence 8 ; au plus 32 questions/citations et 32 requêtes Luna, regroupées par
review ID ; au plus un appel Sol vietnamien. Zéro Apify. Aucun retry fournisseur,
y compris côté client. Les plafonds ne sont pas des quotas à remplir.

Le sélecteur V1.1 équilibré et le filtre de confiance Luna existants sont réutilisés.
Le dossier exact sera figé après JEV, avant Luna. Le dossier des preuves ACCEPTED
et la requête Sol seront figés après Luna, avant Sol. Le format est
`jls-prioritized-recommendations-v1`, avec les consignes
`jls-prioritized-editorial-v1` : fidélité des ingrédients, langage naturel,
priorités fondées sur fréquence disponible, gravité, précision et action possible.

Le contrôle de suffisance avant Sol exige huit preuves ACCEPTED et au moins une
sur chacun des quatre axes ; jusqu'à trois critiques et deux preuves d'avis peu
étoilés lorsqu'elles sont disponibles. Incertitude, couverture incomplète,
empreinte incompatible, modèle changé ou dossier trop volumineux : arrêt sans
recalcul payant. Les preuves et le rapport ne constituent pas une validation humaine.
Les fréquences resteront calculées sur les avis analysés, jamais sur les citations
ni sur les 17 038 avis Google.

## Délégation authentifiée

Tables indépendantes :
`analysis_jls_restaurant_protocols`, `analysis_jls_restaurant_runs`,
`analysis_jls_restaurant_tasks`, `analysis_jls_restaurant_artifacts`.
Lectures RLS owner/admin/manager de la même organisation ; écritures serveur.
Protocole, consentement, requêtes et résultats liés par empreintes SHA256.
Un run unique par protocole ; maximum une tentative par tâche.
Verrou durable sur le run, réservation transactionnelle et cache permanent avant HTTP.
Un appel perdu ou non sauvegardé reste consommé. Les autres réponses d'un même
lot sont attendues et sauvegardées avant de libérer le verrou.

Après le futur GO direct, l'administration authentifiée lit et vérifie le
protocole, l'organisation et l'utilisateur actif via Auth Admin ; elle produit
`restaurantConsent` depuis la directive exacte et l'heure UTC, puis appelle
`authorize_jls_restaurant` avec le SHA256 canonique. Source :
`user_directive_codex_delegation`, opérateur `codex_admin / supabase_mcp`,
expiration 24 heures. Aucun faux clic iPhone ni session empruntée.
Si un run existe, suivre celui-ci ; ne jamais en créer un second.
Le réveil explicite `wake_jls_restaurant` et le worker
`process-jls-restaurant` utilisent le mécanisme de scheduler authentifié existant.
Le cron ne parcourt que les runs autorisés queued/running, jamais les protocoles.

Le GET `jls-restaurant` est purement consultatif. Il ne lance rien et n'est pas
une autorisation. Le déploiement et les migrations ne créent aucun consentement,
run, tâche ou appel fournisseur. Les tests SQL sont entièrement annulés.

## Interface

Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol →
sélectionner Xóm Mới Garden. Préparation FR/VI sans montant ; bouton désactivé,
restauration du statut par lecture après rechargement. Le futur résultat vietnamien
utilisera le renderer des recommandations prioritaires existant.
Les rapports et runs Artisan restent immuables.

## Instruction d'autorisation future

> GO — J'autorise Codex à exécuter une seule fois le rapport vietnamien Xóm Mới
> Garden selon le protocole 34b5a197-b1a6-42e2-b048-e955f1ef8281 : au maximum
> 71 appels JEV V12 économiques, 32 appels Luna regroupés par avis et un appel
> gpt-6.1-sol, sans Apify ni relance payante automatique.
