# FootClan Brawler

A retro side-scrolling beat-'em-up starring Andy, Jason, and Mike from The Fantasy Footballers — built as an application to the Megalabowl / Listener League.

## Play

Open `index.html` in any browser (or visit the hosted link once deployed).

**Controls**
- Move: Arrow keys / WASD — up/down changes your depth in the lane
- Punch: J — tap up to 3 times for a combo string; the third hit knocks down
- Heavy: K — slower, knocks down on its own
- Special: L — costs meter, brief invincibility (panic button)
- Jump: Space — press J in the air for a dive kick
- Dash: double-tap left/right — press J while dashing for a shoulder charge
- **Grab & throw:** knock an enemy down, and when `GRAB!` flashes over them walk in
  and press J to grab. Then J to knee them, or K to hurl them into the pack.

**Dodging:** enemy fire uses a tight depth window — a quick tap of up or down
(about 20px) slips the line. The boss shows a red aim line during his windup;
step off it before he fires.

## Story

Fight through four stages themed on real FootClan franchises — the UDK War Room, the Fantasy Vulture Swamp, the DFS & Betting Floor, and the Megalabowl Colosseum — before facing the final boss: **The Runner-Up**, a giant sentient "2" wearing glasses who has finished second in the Megalabowl every year and now guards the gate to the Listener League.

## The enemies actually play their names

Every enemy has a behaviour that acts out its joke, not just a label:

| Enemy | What it does |
| --- | --- |
| Waiver-Wire Zombie | Races you to health drops and claims them off waivers |
| Stat-Vulture | Swoops on a nearly-dead enemy to steal the kill — you get zero points |
| Rogue Mock-Draftee | Wild, unpredictable "REACH!" lunges from out of range |
| Shady Bookie | Sometimes hedges your hit away entirely — the house always wins |
| Dice Roller | Damage is literally a roll of 2d6, and he tells you what he rolled |
| Trash Talker | Runs his mouth and hypes every nearby enemy into moving faster |
| Rival FootClan Champ | Reads your attack and counters it |
| The Late-Round QB | Throws a fast flat spiral instead of a lob |
| Alpha Vulture | Dive-bombs across the arena |
| The Card Shark | Fans three cards across three lanes at once |
| The Former Champ | Charging shoulder tackle you have to sidestep |

## Score

Points per KO, scaled bonuses for longer combo chains, and an end-of-stage tally
with a rank from **F** to **S** based on deaths, best combo and health remaining.
High score persists in your browser.

## Tech

HTML5 Canvas game, no build step. Everything renders through a low-res buffer upscaled with smoothing off for a genuine chunky-pixel look. Just static files (`index.html`, `style.css`, `game.js`, `assets/`), so it deploys as-is to GitHub Pages / Cloudflare Pages / any static host.

## Art credit

Character sprites are the free "Brawler Series" (Ranger & Renegade rigs) by **chasersgaming**, CC0-licensed, from [OpenGameArt.org](https://opengameart.org/content/brawler-asset-character-ranger-sms) — explicitly built in the Double Dragon / Streets of Rage mold. Recolored via canvas filters to differentiate the three playable hosts and enemy roster. No attribution is legally required under CC0, but it's credited here anyway. Everything else (levels, boss, backgrounds, UI, game logic) is original.
