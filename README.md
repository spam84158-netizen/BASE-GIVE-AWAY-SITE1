# OUTLAW MORDREX GIVEAWAY V2

## Admin
URL: `/admin/`

Identifiant par défaut: `admin`
Mot de passe par défaut: `1221`

Tu peux remplacer ces valeurs avec `ADMIN_USERNAME` et `ADMIN_PASSWORD`.

## Participation
Accueil → Participer → Récompenses → choisir une récompense → inscription → espace participant.

## Chaîne WhatsApp
Admin → Paramètres → URL de la chaîne WhatsApp.

## Vercel
Le projet contient `api/index.js` et `vercel.json`.


## V4 — corrections importantes

- Le bouton `PARTICIPER` de l'accueil ouvre directement `/rewards.html`.
- Le parcours récompense → inscription conserve l'identifiant `reward`.
- `/ref/:code` mémorise le parrain dans un cookie puis ouvre `/rewards.html`.
- Les sessions Admin sont signées avec `COOKIE_SECRET` et ne dépendent plus d'une `Map` mémoire : le login fonctionne entre différentes invocations Vercel.
- Les identifiants Admin restent `admin` / `1221` par défaut et peuvent être remplacés par `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
- La photo de profil reste facultative et l'inscription sans photo/bio reste valide.
- L'URL WhatsApp est pilotée par le paramètre Admin `whatsappChannelUrl`.

### Stockage Vercel

Le mode JSON local est adapté au développement/Termux, mais le système de fichiers Vercel n'est pas un stockage persistant. Pour une production multi-instance, configure une base persistante (par exemple PostgreSQL/Neon) et un stockage persistant pour les images. Ne mets jamais `.env`, `.env.local` ou des secrets dans le dépôt.


## Mise à jour 2.1
- 12 récompenses par défaut incluses.
- Parcours public : code d'accès → récompenses → détail → inscription.
- Affichage du nombre et de la liste des joueurs par récompense.
- Position du joueur calculée par récompense (ex. 18e si 17 sont déjà présents).
- Code admin d'accès : `1221` par défaut, configurable via `ADMIN_ACCESS_CODE`.
- Uploads Vercel écrits dans `/tmp`.
