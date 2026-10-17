# Chill Thái — préparation sur le snapshot historique exact

Version opt-in : `jls-historical-snapshot-v2-vi-v1`.
Format de rédaction : `jls-prioritized-recommendations-v2` ; consignes éditoriales et action température existantes réutilisées.

Source : rapport `39556285-21ee-4962-9892-da3b4f0e8ca3`, analyse 7, vietnamien.
Empreinte historique vérifiée : `5642ee929cce9504e5c21292b5b8b5fbb6f762181c57f918c999760948ba767f`.

## Périmètre

100 identifiants figés, 80 commentaires anglais, 20 avis sans texte. Statistiques générales : dénominateur 100. Fréquences des thèmes : dénominateur 80 si tous les textes sont analysés. Le total Google annoncé dans ce snapshot est 2 745 ; le rapport ne couvre pas ce total.

Les chaînes originales, traductions, données structurées et ancien rapport sont archivés séparément, sans actualiser les traductions. Les identifiants individuels des traductions fournisseur n'étaient pas conservés dans le snapshot historique : cette limite de provenance est indiquée, sans inventer d'identifiant.

Aucun classement historique n'est utilisé comme résultat JEV. Préparation initiale : aucun cache JEV strictement compatible pour Chill ; 80 analyses manquantes. Configuration intégrale `v12_economy_1pass_v1`, 25 thèmes, un passage, modèle demandé `jev-latest`, modèle effectivement servi attendu `jev-1.13.0`. Un changement du modèle servi bloque la compatibilité.

## Réutilisation et CPU

Même file durable, réservation transactionnelle, cache permanent, authentification administrative déléguée, parseur Luna, contrôle de confiance et worker Sol existants. Les anciennes branches restent inchangées par défaut.

Étapes : `jev` → `prepare_evidence` → `luna` → `prepare_sol` → `sol` → `validate_sol`.

Les deux étapes `prepare_*` sont des pauses durables et gratuites. Lors d'un futur GO, Codex exporte l'état autorisé, exécute `scripts/compile-jls-snapshot-v2-stage.ts` sans permission réseau puis lie l'artefact avec `bind_jls_snapshot_preparation`. Aucun dossier n'est reconstruit ou tokenisé dans la réservation Edge. Si Codex s'interrompt, la pause persiste ; le navigateur n'a pas à rester ouvert. Une expiration de consentement bloque sans nouvelle dépense.

La requête finale n'existe qu'après les vraies décisions Luna. Le test technique utilise les textes réels et des classifications/retours entièrement fictifs, explicitement identifiés comme mocks ; aucune référence IA ni prédiction réelle n'en est déduite.

## Plafonds et contrôle préalable

- JEV : 80 appels au maximum, un par commentaire, cache vérifié à nouveau avant réservation.
- Luna : 32 requêtes au maximum, questions regroupées par avis ; nombre exact fixé après sélection réelle, au plus 32 preuves.
- Sol : un appel au maximum, seulement si le dossier accepté passe le contrôle de suffisance.
- Apify : zéro ; aucune relance facturable automatique, aucun SDK avec retry.

Entrée Sol : 32 768 tokens estimés avec marge de 12 % + 256 ; sortie réservée : 9 500. Les instructions, dossier et schéma sont inclus. Le contrôle est refait sur la requête finale. Aucune estimation monétaire pour cette préparation.

Les simulations utilisent uniquement des transports injectés. Les probes Edge authentifiées quittent le handler avant tout chargement de secret fournisseur ; elles ne créent ni consentement, ni run, ni tâche payante. Les mesures natives des cinq phases et la qualification sont archivées dans `analysis_jls_snapshot_preparations`. La préparation locale seule n'autorise pas l'exécution.

## Historique, accès et audit ultérieur

Les artefacts libres sont immuables et idempotents. Lectures owner/admin/manager limitées à l'organisation ; écritures serveur uniquement. Une qualification native complète est requise avant tout nouveau consentement futur.

Accès : Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Chill Thái. Le résultat futur réutilise le lecteur V2, avec preuves et recommandations masquées conservées. Export authentifié `jls-restaurant?establishment_id=…&view=audit` : source historique complète, protocole, tâches et artefacts du nouveau run. Les mocks restent exclus de cet export.

L'export sert à l'audit comparatif dans le chat d'analyse ; aucun audit qualitatif n'est réalisé pendant la préparation. Il permet de distinguer les étapes réellement exécutées/réutilisées, les fréquences par avis distinct, les décisions Luna, les contrôles de recommandations, l'usage et les durées enregistrées.

Le protocole définitif et son SHA256 sont conservés dans Supabase après les tests, avec la provenance du commit de code. Le GO futur doit identifier explicitement ce protocole ; aucun consentement n'est enregistré lors de cette livraison.
