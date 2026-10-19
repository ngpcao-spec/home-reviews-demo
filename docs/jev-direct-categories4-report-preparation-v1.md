# Rapport expérimental Chill Thái — quatre catégories directes

Version : `jev-direct-categories4-luna-sol-report-preparation-v1`.
Format Sol : `jls-direct-categories4-report-v1`.
Préparation gratuite uniquement : aucun consentement, run ou appel fournisseur.

## Sources et comptages

Archive technique : `analysis_jls_snapshot_preparations`,
`087f0b5b-716b-4b94-8a1d-ee2040e22f99`.
Snapshot figé : protocole `bc00633a-30d8-4a90-8e22-dcc6a0efaeb9`.
Les 100 avis restent identiques : 80 textes classés, 20 avis sans texte pour les
statistiques générales uniquement. Les résultats natifs, probabilités et
incertitudes sont conservés. Aucun regroupement des anciennes classifications
à 25 thèmes ne sert à ce rapport.

Les compteurs sont reconstruits et comparés à l'archive par le code. Un avis
mixte contribue aux deux polarités et reste dédupliqué dans chaque catégorie.
Ces fréquences ne mesurent pas la récurrence d'un incident précis.

## Réutilisation et adaptation limitée

- Sélection : `selectBalancedEvidence` et sa politique inchangés. Seuls ses types
  structuraux sont élargis ; aucun comportement historique n'est changé.
- Les clés internes `theme_key` et `atmosphere` servent seulement d'adaptateur au
  sélecteur. Les objets sauvegardés et les questions utilisent les quatre
  catégories ; aucune prédiction à 25 thèmes ni règle lexicale V3 n'est produite.
- Une citation candidate est le texte analytique complet de son avis. Cela évite
  un nouvel extracteur lexical et conserve toutes les négations et nuances.
  La longueur sert seulement au classement de diversité, jamais de validation
  sémantique. Les quasi-doublons sont filtrés par le sélecteur existant.
- Luna : même format Decisions `choice`, parseur natif et filtre expérimental
  existants (confiance minimale 0,60). Questions regroupées par avis. Une nouvelle
  question de catégorie n'hérite pas d'un verdict sur un ancien thème.
- Sol : un seul dossier contenant les compteurs fixes et les preuves acceptées.
  Le contrat retire uniquement les obligations de thèmes/focus historiques pour
  conserver catégories, observations sourcées et actions proposées séparées.
- Suffisance : garde existante réutilisée (huit preuves, quatre catégories,
  critiques et notes basses lorsque disponibles). Si elle échoue, Sol reste bloqué.
- Taille : contrôle complet existant `solRequestSize`, enveloppe 32 768 tokens
  d'entrée avec marge, sortie réservée de 9 500 tokens. Aucun coût estimé.

Le dossier Sol sauvegardé avant Luna est **conditionnel**, avec toutes les
candidates pour inspection et contrôle de taille. Il n'est pas une requête
autorisée ni un rapport. Après les verdicts, `directAcceptedSol` reconstruit le
dossier avec les seules preuves acceptées, sans changer les compteurs JEV.
Les refus et incertitudes ne peuvent pas justifier une recommandation.

## Exécution et limites

Le compilateur et le contrat ne sont pas un moteur d'exécution. Les requêtes
préparées utilisent les formats des transports existants. Aucun worker, endpoint,
interface, table, autorisation ou mécanisme d'appel supplémentaire n'est créé.
Toute exécution future doit passer par le mécanisme existant de consentement,
réservation durable avant envoi, reçu brut et validation/sauvegarde séparées.
Une tentative incertaine reste consommée ; aucun retry fournisseur automatique.

Les liens, citations, hashes, catégories, polarités et compteurs sont contrôlés.
Cela ne garantit pas toute la fidélité d'une rédaction libre et ne constitue
pas une validation humaine indépendante. Aucun audit qualitatif n'est effectué.

## Vérification hors réseau

`scripts/prepare-jev-direct-report.ts` produit l'archive locale privée.
`scripts/rehearse-jev-direct-report.ts` teste le dossier réel avec des réponses
Luna/Sol explicitement simulées et une sauvegarde/relecture locale. Les lancer
avec Deno `--cached-only --deny-net --allow-read --allow-write`.
Les mocks ne confirment ni le comportement ni la précision des fournisseurs.
