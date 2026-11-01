# 20bucks brand guide

The look 20bucks already has, read from the live app at v1.4.1 (cool grey · one blue accent · green/red for money · rose for shared spending · Geist). Full guide: [DESIGN.html](DESIGN.html). Open it from a checkout: it loads the repo's own icons and Geist files by relative path.

| What | Where |
|---|---|
| Mark | `icons/`: three coins, rose on top |
| Colours | `app.css` (light and dark); every token is listed in DESIGN.html. There is no `tokens.json` here because the repo ignores all `*.json`, so money data can never be committed |
| Type | Geist 400–700, self-hosted in `fonts/`, tabular figures |

Nothing in this folder is new artwork: every colour, font and file it names is already in the app.

## Repo avatar and social preview

| File | Where it's used |
|---|---|
| `docs/brand/avatar.png` | GitLab project avatar (Settings > General), 512×512 |
| `docs/brand/social-preview.png` | GitHub social preview (github.com/Ethosan/moneytracker, Settings > Social preview), 1280×640 |

Every one of these repos follows the same spec: a 512×512 PNG avatar with the project's own mark on its own background to every edge, since GitLab and GitHub round it themselves; and, for repos mirrored to GitHub, a 1280×640 social preview with the avatar tile, the name and the repo description, no URL. Both are made from the mark, not new artwork.
