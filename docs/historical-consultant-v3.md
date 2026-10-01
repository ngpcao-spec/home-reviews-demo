# Rapport historique consultant V3

## Périmètre

- Génération manuelle via le bouton Analyses existant, sans n8n.
- Données : tous les avis 1–5★ stockés pour l’établissement autorisé, y compris ceux sans texte.
- Langue : `profiles.preferred_language`, jamais une langue arbitraire fournie par le navigateur.
- Les rapports V1/V2 restent lisibles tant qu’une génération V3 n’a pas réussi.
- Aucun changement des règles opérationnelles, notifications, taux négatif par étoiles, import ou surveillance.

## Contrat

Huit sections fixes : synthèse des avis, Service, Qualité, Prix, Ambiance, aspects positifs, aspects négatifs, conclusion et ses quatre recommandations.

La classification analytique est distincte des statistiques opérationnelles :

- un avis = une classification positive ou négative ;
- sens global du texte original en priorité ;
- ambiguïté/absence de texte : 4–5★ positif, 1–3★ négatif ;
- une classification absente, invalide, dupliquée ou sans preuve textuelle exacte utilise le fallback 4–5★ positif / 1–3★ négatif, sans bloquer le batch ; les IDs inconnus sont ignorés ;
- les totaux sont calculés côté serveur, pas fournis par le modèle ;
- les mentions sont des identifiants d’avis distincts par thème/sentiment et par axe/sentiment ; les thèmes ne sont jamais additionnés pour obtenir le total ;
- un avis peut contribuer à plusieurs axes et aux deux sentiments d’un axe.

Le moteur fournit un catalogue fixe avec synonymes regroupés. Chaque finding doit être ancré dans un extrait exact normalisé (Unicode/espaces). Un finding non sourcé est rejeté individuellement ; les décomptes thématiques portent uniquement sur les findings acceptés. Comme pour toute extraction IA, le grounding vérifie la présence de la preuve, pas l’infaillibilité de son interprétation sémantique.

### Classification résiliente

Une classification textuelle valide prime toujours sur la note (un 5★ critique peut être négatif). Le fallback ne crée aucun finding et ne contribue pas aux comptes des thèmes. Une enveloppe structurée entière inutilisable reste une erreur de batch.

Avant sauvegarde, les classifications sont reconstruites depuis les IDs du snapshot, revalidées, complétées par la note si nécessaire puis persistées. Les comptes positif/négatif sont exclusivement calculés depuis cette liste finale ; leur somme est vérifiée et la contrainte SQL existante reste active.

La métrique durable du run est le nombre de `classifications` ayant `basis = rating`. Elle inclut les avis sans texte, les réponses `insufficient` et les propositions invalides/manquantes, une seule fois par avis. Elle est également conservée dans `consultant_report.classification_fallback_count` et les logs de compteurs (sans texte d’avis). Aucun nouveau champ SQL ni migration n’est nécessaire. Version, fingerprint et découpage des batches restent inchangés : un run échoué reprend à son curseur si les données sont identiques.

## Reprise, coûts, confidentialité

Les snapshots de génération, leases, curseurs, jetons et reprises existants sont réutilisés. Lots plafonnés à vingt avis textuels et une taille de texte bornée, sans troncature silencieuse. Pas d’appel IA individuel par avis. Les avis sans texte utilisent la note sans appel IA. Une synthèse finale agrège les topics ; aucun appel final n’est nécessaire en l’absence de topics.

Le modèle de synthèse reçoit uniquement les topics anonymes et les comptes validés, sans nom, adresse, auteur ou citation. Les recommandations doivent citer des clés de topics appartenant à leur axe. Un axe absent reçoit un message d’insuffisance. Les nombres du rapport sont affichés depuis les résultats serveur, pas depuis du texte libre généré.

Les nouveaux champs sont `analytical_positive_count`, `analytical_negative_count`, `consultant_report` et les classifications privées du run. Une contrainte PostgreSQL impose l’égalité des totaux V3. Les anciennes colonnes ne sont pas supprimées. Le rapport V3 n’affiche pas de nom/photo d’établissement ; le sélecteur de navigation reste utilisable.

## Vérification / déploiement

- Tests unitaires : classification textuelle contraire à la note, avis sans texte, preuves, doublons, totaux, quatre axes, recommandations, continuation, échec sans perte, concurrence et authentification.
- Tests frontend FR/VI : huit sections, quatre recommandations, séparation des langues et des métriques opérationnelles.
- Tests navigateur avec fixtures synthétiques : 360/390/430 px et desktop. Aucun test iPhone physique.
- Migration testée avec une table temporaire clonant les contraintes puis rollback : total valide accepté, total invalide rejeté. Aucune écriture de rapport réel pendant ce test.
- Aucun appel Apify, Outscraper ou IA réel effectué pour cette livraison. La qualité rédactionnelle d’une génération réelle reste à valider via le bouton manuel.

Les RLS existantes sont inchangées : lecture des rapports par appartenance organisation ; aucune lecture des runs ni écriture des rapports par le rôle authenticated. `generate-historical-report` conserve `verify_jwt=true`, `requireUser`, l’appartenance organisation et le rate limit.

L’audit Supabase relève aussi des avertissements préexistants hors périmètre : [pg_net dans public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [RPC SECURITY DEFINER existantes](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [protection des mots de passe compromis](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Les tables internes sans politique de lecture restent volontairement réservées au serveur.

Rollback : restaurer le code de génération V2 et le frontend précédent sans supprimer les nouvelles colonnes. Les rapports V3 déjà générés ne doivent pas être requalifiés artificiellement en V2 ; ils nécessiteraient une nouvelle génération manuelle si l’ancienne présentation était imposée.
