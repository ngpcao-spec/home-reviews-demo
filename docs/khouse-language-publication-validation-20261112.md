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

Résultats locaux : TypeScript et ESLint passent ; 19 tests de lecture/affichage de rapports et d'affichage linguistique passent.

Résultat isolé réussi : commit `bb4ab6d1843a3202c160336f5bd4d4a9e2307530`, run [43130513980](https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/43130513980), job `130893197253`. Playwright : 48,8 secondes ; les 11 reçus obligatoires sont présents. Reconstruction vide, contrôles des dépendances, Auth, workers, navigateur et nettoyage réussis.

Observations vérifiées :

- Quatre sessions Auth dans quatre organisations, deux FR et deux VI ; un restaurant commun et deux avis source communs.
- Deux demandes initiales VI simultanées : un seul run VI ; réabonnement VI immédiat sans run supplémentaire et sans notification négative historique.
- Lecture authentifiée des deux traductions VI Apify, sans traduction interne. Un cycle FR ne déplace pas le repère VI ; le cycle VI suivant retrouve les avis déjà connus et ajoute leur version linguistique sans doubler les avis.
- Cinq runs Apify **simulés** au total : initial FR, sync FR de référence, initial VI partagé, puis un cycle FR et un cycle VI pour vérifier les repères. Un appel IA **simulé**, celui du scénario préexistant d'analyse FR compatible ; aucun appel IA supplémentaire pour les nouveaux cas.
- Publication sans analyse parallèle : égalité JSON des 150 sources et 32 preuves dans le stockage et les réponses API, contenu/date/langue inchangés, état périmé, aucune citation inventée. Capture répétée et enrichissement d'une ancienne archive incomplète vérifiés. Rapport visible dans les deux interfaces VI ; refus de le lire implicitement comme version FR.
- Les contrôles précédents affectés passent aussi : isolation privée, notifications en application, menus avec variantes, désabonnement, hors pilote et retour arrière sans nouvelle collecte.

Les deux essais CI intermédiaires ont échoué avant ce succès : le premier a mis en évidence le droit SELECT manquant du rôle serveur sur les tables communes utilisées par le nouveau contrôle de couverture ; le second a révélé des identifiants de fixture non UUID dans la lecture historique existante. Le droit est limité à service_role ; les fixtures utilisent désormais des UUID, comme les archives réelles. Aucun test obligatoire n'a été supprimé pour obtenir le succès.

## Reconstruction : exclusions explicites

| Opération | Partie exclue | Justification et éléments conservés |
|---|---|---|
| Schéma scheduler récupéré | Provisionnement du secret | Aucun secret de production copié ; vraies fonctions, types, contraintes et droits conservés ; secret synthétique local |
| 20260928160000 load test | Exécution du benchmark 100/1 000/10 000 établissements | Charge historique sans rôle dans le schéma ; fonctions/tables/droits conservés |
| 20261010064000 audit V13 | Insertion de 18 annotations historiques et assertion sur ces données | Identifiants historiques absents d'une base vide ; définitions conservées |
| 20261025022056 retention cleanup | Purge historique conditionnée à une sauvegarde et désactivation temporaire des triggers | Ne pas purger des données ni inventer une sauvegarde ; remplacement FK et politique persistante conservés |
| 20261025095207 reset content | Fichier de purge historique entier | Aucune définition persistante ; garde de reconstruction rejetant une dérive contenant du DDL |
| Expérience Nha Trang cinq lots récupérée | Insertion d'autorisation expérimentale | Ne pas réarmer une expérience ; tables/fonctions/droits conservés |

Les URLs de callbacks sont remplacées par un endpoint local inactif uniquement dans les copies exécutées en CI. Cron est désactivé. Les fonctions métier ne sont pas remplacées par des simulacres ; les anciens points d'entrée de traduction interne volontairement désactivés par la vraie migration de production restent désactivés. La chaîne comprend 272 fichiers de migration et 21 fichiers récupérés, avec les exclusions explicites ci-dessus. Sa reconstruction réussit ; aucune dépendance applicative manquante n'a été détectée par les contrôles de catalogue et les parcours exécutés. Les fichiers de reconstruction ne doivent jamais être déployés en production.

## Pilote

Les deux écarts identifiés sont corrigés et validés en environnement isolé. Le futur pilote accepte une collecte par langue nécessaire, mutualisée entre abonnés de cette langue. Le coût d'une collecte FR manquante reste à autoriser au moment de l'activation ; il n'est pas dépensé pendant cette validation. Liste de Place IDs initialement vide, runtime désactivé. K.HOUSE uniquement après décision séparée. Aucun changement aux règles de reprise des rapports, aux menus Rainminer, aux notifications privées ou aux données existantes.

Avant activation restent les contrôles opérationnels du dossier de préparation : comparer les définitions actuellement déployées avec les points d'insertion des migrations, sauvegarder les versions à rétablir, déployer désactivé, puis autoriser séparément le pilote et son éventuelle collecte FR. Ajouter la migration du 12 novembre APRÈS les 13 migrations de mutualisation ; ne pas rejouer le schéma initial. Le retour arrière existant est retesté avec les deux langues et la publication : drainer les traitements puis désactiver, sans supprimer les données communes.

Conserver les limites de la validation précédente : livraison push externe et cadence cron réelle non exécutées, fournisseurs simulés, absence de répétition sur une copie complète de production. La fixture des 150 références d'un rapport n'est pas un test de saturation de la fenêtre des 150 avis.
