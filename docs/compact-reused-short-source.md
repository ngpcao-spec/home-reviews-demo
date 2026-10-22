# Réutilisation du prompt court dans le parcours Sol compact

Adaptation technique expérimentale, sans changement du prompt Sol compact,
du modèle, du raisonnement, du sélecteur ou des classifications historiques.

Le contrat compact existant accepte désormais une source explicitement liée
à un corpus immuable et à une archive de classifications
`direct4_short_common_1pass_v1`. Le parseur conserve les choix natifs et les
probabilités. Les anciens protocoles sans ce rattachement gardent leurs
contrôles précédents.

`save_jls_compact_reused_source` vérifie une fois les textes, les reçus,
les requêtes JEV, les modèles servis, les résultats et les comptages contre
les archives originales. Le certificat est immuable et idempotent par
protocole de classification. Les réveils du worker vérifient ce certificat
et les requêtes figées, sans reconstruire les réponses historiques.

L'exécution réutilise les protocoles candidats, le consentement spécifique,
la réservation Sol atomique et les reçus existants. Elle autorise au maximum
un appel Sol, aucun appel JEV/Luna/Apify et aucune répétition fournisseur.
L'archive de préparation n'est pas une autorisation de dépense.

## Vérification Foursea, hors réseau fournisseur

- 100 sources figées : 91 textes, neuf avis sans texte.
- 87 réponses JEV du prompt court commun, quatre résultats techniques
  manquants conservés séparément, sans classement inventé.
- Sélecteur existant : 32 associations, 24 avis distincts.
- Requête complète : 53 096 octets ; estimation `o200k_base` 10 156 tokens,
  11 631 avec marge, budget d'entrée inchangé de 32 768 tokens.
- Rejeu du dossier réel : vérification, réveils concurrents, réservation,
  envoi simulé, réception brute, reconstruction, validation et sauvegarde.
- Contrôles SQL par le rôle `service_role`, annulés en fin de test :
  isolation, plafonds, idempotence, deuxième réservation refusée et
  conservation du rapport reconstruit.

Ces tests vérifient le raccordement technique. Les réponses simulées ne
constituent aucune mesure de qualité rédactionnelle du fournisseur.
