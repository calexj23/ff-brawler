# FootClan Brawler

A retro side-scrolling beat-'em-up starring Andy, Jason, and Mike from The Fantasy Footballers — built as an application to the Megalabowl / Listener League.

## Play

Open `index.html` in any browser (or visit the hosted link once deployed).

**Controls**
- Move: Arrow keys / WASD (also up/down to dodge sideways)
- Jump: Space
- Punch: J
- Kick: K
- Special: L (needs meter)

## Story

Fight through four stages themed on real FootClan franchises — the UDK War Room, the Fantasy Vulture Swamp, the DFS & Betting Floor, and the Megalabowl Colosseum — before facing the final boss: **The Runner-Up**, a giant sentient "2" wearing glasses who has finished second in the Megalabowl every year and now guards the gate to the Listener League.

## Tech

HTML5 Canvas game, no build step. Everything renders through a low-res buffer upscaled with smoothing off for a genuine chunky-pixel look. Just static files (`index.html`, `style.css`, `game.js`, `assets/`), so it deploys as-is to GitHub Pages / Cloudflare Pages / any static host.

## Art credit

Character sprites are the free "Brawler Series" (Ranger & Renegade rigs) by **chasersgaming**, CC0-licensed, from [OpenGameArt.org](https://opengameart.org/content/brawler-asset-character-ranger-sms) — explicitly built in the Double Dragon / Streets of Rage mold. Recolored via canvas filters to differentiate the three playable hosts and enemy roster. No attribution is legally required under CC0, but it's credited here anyway. Everything else (levels, boss, backgrounds, UI, game logic) is original.
