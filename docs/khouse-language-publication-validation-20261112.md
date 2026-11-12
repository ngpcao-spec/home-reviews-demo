# K.HOUSE — langues et publication archivée

## Périmètre

Correctif additif `20261112003725_shared_language_reuse_and_publication_evidence.sql`, préparé sur la branche de validation. Aucun changement des migrations déjà appliquées, aucune activation ni écriture en production. Les lectures de production n'ont exporté ni avis, ni brouillons, ni identités de clients dans les fixtures publiques.

## Constat en lecture seule

Les 150 réponses conservées pour K.HOUSE comprennent 143 `textTranslated` avec `translatedLanguage=vi`, tous concordants avec les traductions enregistrées, et 7 réponses sans traduction. Aucune version FR enregistrée. L'import terminé et les 23 synchronisations disposant d'un run sont tous en VI. Les archives de l'application ne permettent donc pas de fournir la version FR complète sans une collecte FR ultérieure. Aucun appel Apify n'a été lancé pour cette vérification ; aucune affirmation n'est faite sur des runs externes jamais enregistrés par l'application.

La publication VI du 28 octobre contient 150 `source_bindings` et 32 `evidence_bindings`, sans ligne correspondante dans `analysis_parallel_reports`. Il s'agit de références et d'empreintes : les citations originales ne sont pas présentes dans ces tableaux. Le correctif les conserve telles quelles, sans inventer de citations.

## Comportement préparé

- Identité commune : restaurant + identifiant source de l'avis. Versions linguistiques rattachées au même avis et à son empreinte de texte.
- Réemploi d'une collecte déjà terminée dans la langue demandée, même si Google n'avait pas fourni la traduction d'un article. Une autre langue ne suffit que si les textes originaux ou traductions sauvegardées couvrent les avis lisibles.
- Si la langue nécessaire manque, recours au worker initial réel et à sa réservation commune par restaurant/langue/configuration. Deux demandes VI ne créent pas deux runs VI. FR et VI peuvent légitimement nécessiter deux collectes.
- Aucune traduction interne ajoutée ; l'affichage continue de lire uniquement la version Apify correspondant à la langue du compte, ou l'original avec un statut de traduction manquante.
- Les repères de synchronisation sont indépendants par langue. Une diffusion FR ne fait pas avancer le repère VI et ne prive pas la collecte VI suivante de traductions.
- L'abonnement qui réutilise les données initialise la cadence à partir de la collecte réussie ; il ne force pas `next_sync_at=now()`.
- Les clés de compatibilité des analyses restent fondées sur le contenu, la langue, le modèle et la configuration. Une publication d'une autre langue reste consultable explicitement comme version datée, sans devenir un rapport neuf ou une analyse compatible.
- L'archive conserve le document, sa date, sa langue, son état périmé, les deux tableaux de références et la provenance. Elle complète une ancienne archive incomplète sans remplacer son contenu ni effacer ses sources textuelles déjà conservées. Les lectures partagées exposent les tableaux de références, même sans source parallèle. `source_available=false` reste exact lorsque les textes sources sont absents.

## Vérifications ciblées

Le scénario isolé existant est étendu, car ses parcours d'ajout et de synchronisation sont affectés. Vraies sessions Supabase Auth, base et workers ; fournisseurs HTTP simulés. Deux comptes FR existants, puis deux comptes VI : demandes simultanées pour la langue absente, reprise du même travail en attente, réabonnement de même langue sans nouveau run, lecture des traductions VI via RPC authentifiée. Une synchronisation FR ne doit pas avancer le repère VI ; la synchronisation VI suivante reçoit les mêmes identifiants avec leur traduction, sans doublon.

Le rapport représentatif utilise exactement la forme observée en production : 150 références de sources, 32 références de preuves, texte source absent, publication périmée et absence de ligne parallèle. Assertions d'égalité JSON complète des deux tableaux, conservation du document/date/langue, capture répétée idempotente, réparation d'une archive incomplète, accès par deux sessions et affichage dans l'interface. Les données et textes de la fixture sont synthétiques.

Résultats locaux : TypeScript et ESLint passent ; 17 tests de lecture/affichage de rapports passent. Le résultat GitHub Actions sera inscrit après exécution ; un lancement seul n'est pas une validation.

## Reconstruction : exclusions explicites

| Opération | Partie exclue | Justification et éléments conservés |
|---|---|---|
| Schéma scheduler récupéré | Provisionnement du secret | Aucun secret de production copié ; vraies fonctions, types, contraintes et droits conservés ; secret synthétique local |
| 20260928160000 load test | Exécution du benchmark 100/1 000/10 000 établissements | Charge historique sans rôle dans le schéma ; fonctions/tables/droits conservés |
| 20261010064000 audit V13 | Insertion de 18 annotations historiques et assertion sur ces données | Identifiants historiques absents d'une base vide ; définitions conservées |
| 20261025022056 retention cleanup | Purge historique conditionnée à une sauvegarde et désactivation temporaire des triggers | Ne pas purger des données ni inventer une sauvegarde ; remplacement FK et politique persistante conservés |
| 20261025095207 reset content | Fichier de purge historique entier | Aucune définition persistante ; garde de reconstruction rejetant une dérive contenant du DDL |
| Expérience Nha Trang cinq lots récupérée | Insertion d'autorisation expérimentale | Ne pas réarmer une expérience ; tables/fonctions/droits conservés |

Les URLs de callbacks sont remplacées par un endpoint local inactif uniquement dans les copies exécutées en CI. Cron est désactivé. Les fonctions métier ne sont pas remplacées par des simulacres ; les anciens points d'entrée de traduction interne volontairement désactivés par la vraie migration de production restent désactivés. La reconstruction vérifie les dépendances applicatives critiques après toute la chaîne, puis exécute les parcours réels. Les fichiers de reconstruction ne doivent jamais être déployés en production.

## Pilote

Le futur pilote accepte une collecte par langue nécessaire, mutualisée entre abonnés de cette langue. Le coût d'une collecte FR manquante reste à autoriser au moment de l'activation ; il n'est pas dépensé pendant cette validation. Liste de Place IDs initialement vide, runtime désactivé. K.HOUSE uniquement après décision séparée. Aucun changement aux règles de reprise des rapports, aux menus Rainminer, aux notifications privées ou aux données existantes.

Conserver les limites de la validation précédente : livraison push externe et cadence cron réelle non exécutées, fournisseurs simulés, absence de répétition sur une copie complète de production. La fixture des 150 références d'un rapport n'est pas un test de saturation de la fenêtre des 150 avis.
