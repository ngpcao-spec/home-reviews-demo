# Fidélité vietnamienne et choix des priorités

Nouvelle préparation : `jls-prioritized-editorial-v1`.
Validateur futur : `jls-prioritized-editorial-validation-v1`.
Format de sortie conservé : `jls-prioritized-recommendations-v1`.
Schéma inchangé ; prompt, dossier, requête et configuration ont de nouveaux SHA256.

Les modules historiques et le protocole exécuté restent inchangés.
Cette version ne modifie ni le rapport Artisan ni la revalidation de l’événement 5.
Elle n’est raccordée à aucun worker d’exécution. L’ancien consentement ne peut pas
autoriser sa nouvelle requête. Aucun protocole, run ou consentement n’est créé.

## Traduction et rédaction

Le prompt impose de préserver le plat, ses ingrédients et leurs relations, les
qualifications et les ambiguïtés. Les contrôles futurs signalent certaines
contradictions explicites (plat à base d’œufs avec du poisson versus œufs de
poisson) sans identifiant de restaurant ou d’avis. Ils ne remplacent pas un
contrôle sémantique et ne garantissent pas toute la fidélité d’une traduction.

Les titres, constats, actions et justifications sont rédigés en langage courant.
Identifiants, hashes, clés de fréquence et statuts restent dans les champs
structurés d’audit. Un contrôle futur masque le vocabulaire interne repéré,
sans réécrire le texte Sol ni effectuer un appel de correction.

Exemples **synthétiques**, non appliqués au rapport historique :

- Source : « an omelet with salted fish » ; formulation : « trứng chiên với cá muối ».
- Justification : « L’attente prolongée rapportée mérite un examen du suivi de
  commande. Les autres critiques sur les délais ne démontrent pas la répétition
  de cet incident dans cette zone. »
- Vietnamien : « Thời gian chờ kéo dài được khách phản ánh là điểm cần kiểm tra.
  Những phản ánh khác về thời gian chờ không chứng minh sự việc này lặp lại tại
  khu vực đó. »

## Priorités et dossier

Une revue de couverture expose les 25 thèmes, leurs comptages globaux et les
preuves négatives admissibles. Le prompt croise fréquence fiable, gravité,
précision des citations et possibilité d’action. Il n’impose ni une baisse de
prix ni une recommandation de prix. Zéro à cinq recommandations reste valide.
Une fréquence de thème n’est jamais celle d’un incident précis.

Artisan : 422 avis analysés, 24 citations ACCEPTED. Les cinq thèmes examinés
disposent tous de preuves négatives admissibles :

| Thème | Avis JEV négatifs | Avis avec preuve admissible dans ce dossier |
|---|---:|---:|
| Niveau des prix | 41 | 2 |
| Qualité des plats | 35 | 2 |
| Rapport qualité/prix | 28 | 1 |
| Attente | 10 | 2 |
| Facturation | 8 | 1 |

Cela permet leur examen, sans garantir que les exemples justifient une action
précise ou soient représentatifs. Quatorze thèmes négatifs ne possèdent aucune
preuve admissible ici, dont attention, professionnalisme et coordination.
Ces lacunes sont signalées ; aucune preuve n’est inventée ou réanalysée.

Pour respecter le budget de 20 000 tokens, le dossier futur omet uniquement le
bloc de contexte structuré détaillé (groupes, repas, bruit, attente et tranches
de prix, `structured_context_stats`)
et évite la répétition des comptages par clé. Les statistiques pertinentes des
25 thèmes, quatre axes, étoiles, couverture et croisements Google sont conservées.
Le serveur conserve toutes les statistiques originales et leur empreinte complète.
Les citations, contextes et empreintes restent exacts. L’export futur est distinct
du dossier historique et possède sa propre empreinte.

## Stockage et affichage

Le journal append-only `analysis_jev_luna_sol_events` conserve une préparation
par organisation, plan et langue, sous `prioritized_editorial_prepared_v1`.
Écritures serveur via `save_jls_editorial_preparation`, lectures RLS, idempotence.
Le GET vérifie ou construit gratuitement cette préparation ; il ne l’enregistre
pas et ne crée aucun job. Une erreur ne masque pas le rapport historique.

L’écran FR/VI présente les consignes futures, les lacunes, tous les thèmes et
des exemples explicitement synthétiques. Le dossier technique est dans un
accordéon d’audit. Le bouton de futur essai reste désactivé.

Une future génération demandera un GO distinct et un protocole lié à ces nouvelles
empreintes ; aucun mécanisme d’exécution ni plafond existant n’est modifié ici.
