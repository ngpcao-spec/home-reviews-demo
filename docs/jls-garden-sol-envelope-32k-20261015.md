# Xóm Mới Garden — reprise séparée, enveloppe Sol 32k

Préparation expérimentale du 15 octobre 2026. Aucun consentement, run,
tâche payante, réveil ou appel fournisseur créé par cette livraison.
L'ancien protocole `34b5a197-b1a6-42e2-b048-e955f1ef8281` et le run bloqué
`692e206a-b2b1-4fba-9512-4c164607e2b5` restent immuables.

## Mesure reproductible sans fournisseur

Périmètre source SHA256 : `ee06d5dbbf26fbd897167e526793c93af31cc993487dfb36ffd75d4274609d55`.
587 avis stockés, 550 avec texte, 78 textes anglais figés, 472 sans anglais.
78 analyses V12 économiques complètes compatibles : 7 anciennes et 71 issues
du run arrêté. Réutilisation des 78 ; aucun nouveau JEV.
Statistiques SHA256 : `cef80878fcb605c51fd03f016a0f1c30647fb6e6f43f811c138c4f64898681d4`.

Le sélecteur V1.1 inchangé conserve 32 citations et leurs contextes sur 28 avis.
Le dossier conditionnel inclut toutes les preuves candidates avant Luna.
Il ne contient aucun faux verdict Luna. Seul le futur dossier effectivement
ACCEPTED, lié aux réponses natives, peut être transmis à Sol.

| Mesure de la requête complète | Valeur |
| --- | ---: |
| JSON UTF-8, instructions + dossier + schéma + paramètres | 67 867 octets |
| Tokens locaux o200k_base, JSON complet | 19 137 |
| Instructions seules | 977 |
| Dossier seul | 16 784 |
| Schéma seul | 869 |
| Entrée prudente, plafond de 12 % puis 256 tokens de cadrage | 21 690 |
| Marge incluse | 2 553 |
| Nouveau plafond entrée | 32 768 |
| Marge disponible sous ce plafond | 11 078 |
| Réserve sortie, raisonnement compris | 9 500 |
| Entrée prudente + réserve sortie | 31 190 |

Les composants comptés séparément ne s'additionnent pas exactement au JSON
complet, dont les chaînes sont échappées et qui contient des paramètres.
Il s'agit d'une estimation locale, pas de tokens facturés.
L'ancien dossier legacy conditionnel atteignait 20 197 tokens prudents et
échouait avant même la construction de la requête éditoriale actuelle.

## Limites et contrôles

Politique indépendante `jls-sol-envelope-32k-v1` ; protocole
`jls-restaurant-resume-vi-32k-v1`. Les politiques historiques 20k restent
inchangées. Tous les builders imbriqués et les validateurs propagent
explicitement la nouvelle politique, sans contourner les contrôles métier.

Limites publiées de [gpt-6.1-sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) :
1 050 000 tokens de contexte, 128 000 maximum de sortie.
Le plafond complet autorisé 32 768 + 9 500 = 42 268 reste inférieur au contexte.
Le corps JSON est également plafonné à 1 Mio.

[Supabase Edge](https://supabase.com/docs/guides/functions/limits) : mémoire 256 Mio,
CPU 2 s par requête hors I/O, durée minimale documentée 150 s (400 s payant),
idle 150 s. Timeout fournisseur conservé à 110 s, réserve infrastructure
minimale 40 s ; bail durable 300 s. Aucun retry ou basculement d'API.
La durée réelle de génération et les quotas/disponibilités du compte ne sont
pas garantis par cette vérification documentaire ; aucun appel de sondage.

Vérification de l'enveloppe complète avant toute étape Luna, puis du dossier
accepté avant création de la tâche Sol et immédiatement avant le POST Sol.
Toute incompatibilité, dépassement, réponse perdue ou facturation incertaine
bloque sans nouvelle tentative payante. Aucune preuve n'est raccourcie ou
supprimée pour satisfaire le plafond.

La préparation lie les empreintes du cache, du snapshot, de la configuration,
des 32 preuves, des questions Luna, du dossier conditionnel, du prompt,
du schéma et de la requête. Le futur consentement doit nommer le nouveau
protocole, être récent et expirer sous 24 h. Le précédent GO n'est pas repris.

## Exécution encore nécessaire après un nouveau GO

- JEV : 0 appel.
- Luna : 28 requêtes au maximum, 32 questions regroupées par avis ; aucun
  résultat Luna de ce dossier n'existe dans le run arrêté.
- Sol : 1 appel au maximum, seulement si les preuves acceptées sont suffisantes
  et la nouvelle enveloppe respectée.
- Apify : 0. Aucune estimation monétaire produite.

FR/VI : Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Xóm Mới Garden.
L'écran affiche la mesure, le plafond, la sortie réservée et l'historique arrêté.
Le bouton reste désactivé en attente d'un nouveau GO délégué.

## Vérifications

Tests sans réseau fournisseur : cache compatible, intégrité de l'ancien
protocole, enveloppe dépassant 20k mais inférieure à 32k, refus au-delà de 32k
ou 1 Mio, modèle/sortie/politique modifiés, préflight modifié, contrôle avant
HTTP après réservation, reprise sans clé JEV, citations et contextes complets.
SQL/RLS exécutés en transaction annulée : idempotence, absence de consentement,
ancien run bloqué, rôles et organisations, anti-doublons, bail, immutabilité,
absence de retry. Tests FR/VI 360/390/430 et iPad 768, rechargement et zéro POST.
