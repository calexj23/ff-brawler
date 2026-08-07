# FootClan Brawler

A retro side-scrolling beat-'em-up starring Andy, Jason, and Mike from The Fantasy Footballers — built as an application to the Megalabowl / Listener League.

## Play

Open `index.html` in any browser (or visit the hosted link once deployed).

**Controls**
- Move: Arrow keys only — up/down changes your depth in the lane
- Punch: J or A — tap up to 3 times for a combo string; the third hit knocks down
- Heavy: K or S — slower, knocks down on its own
- **J+K (or A+S) together: signature move** — a different, mechanically distinct attack for every host (see below)
- Special: L or D — costs meter, brief invincibility (panic button)
- Jump: Space or W — press J/A in the air for a dive kick
- Dash: double-tap left/right — press J/A while dashing for a shoulder charge
- **Grab & throw:** knock an enemy down, and when `GRAB!` flashes over them walk in
  and press J to grab. Then J to knee them, or K to hurl them into the pack.
- Mute music: M
- High scores: H, from the title screen

**Dodging:** enemy fire uses a tight depth window — a quick tap of up or down
(about 20px) slips the line. The boss shows a red aim line during his windup;
step off it before he fires.

## Three genuinely different movesets

Not just different numbers — different mechanics, so each host actually plays
differently:

| Character | J+K Signature | What makes it distinct |
| --- | --- | --- |
| Andy | **Zinger Flurry** | Multi-hit — ticks damage repeatedly for as long as an enemy stays in range. Fastest character, fastest move. |
| Jason | **Impression Slam** | Leaps into the air (visual only, doesn't touch the jump system) and comes down in a wide AOE that can hit multiple enemies at once. |
| Mike | **Power Chord Smash** | One devastating single-target hit — the biggest number in the game, with the guitar's extended reach. |

Mike's guitar isn't cosmetic: every one of his melee attacks has longer range
than Andy's or Jason's fists, and it visibly swings as the weapon during every
attack pose. Andy wears an oversized ball cap in every pose, on and off the field.

## Story

Fight through four stages themed on real FootClan franchises — the UDK War Room, the Fantasy Vulture Swamp, the DFS & Betting Floor, and the Megalabowl Colosseum — before facing the final boss: **NUMBER TWOOOOO**, a giant sentient "2" wearing glasses who has finished second in the Megalabowl every year and now guards the gate to the Listener League.

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
High score persists in your browser. Win or lose, the run ends with a name-entry
screen (up to 40 characters) that saves your score to a local top-10 leaderboard.

## The three specials are three real bits

Each playable host's special move is built around something they actually do on
the show, not an invented gimmick:

| Character | Special | The real bit |
| --- | --- | --- |
| Andy "Welcome In" Holloway | **Welcome In!** | His real intro catchphrase. Landing it hypes the crowd and gives Andy a real speed buff for a few seconds. |
| Jason "Mailbag" Moore | **#FootClan Mailbag** | The show's actual recurring listener-question segment. Pulls a real-style mailbag question on screen before the hit lands. |
| Mike "The Fantasy Hitman" Wright | **Thunderstruck** | The Hitman's power-chord energy, turned into three lightning bolts that sweep top-to-bottom across the screen instead of a thrown object. |

## Music

Six looping chiptune tracks (title/select, and one per level theme, plus a faster one for the final boss gate), all procedurally sequenced through Web Audio — no audio files, same "no build step" philosophy as the sound effects. Press M to mute.

## Tech

HTML5 Canvas game, no build step. Everything renders through a low-res buffer upscaled with smoothing off for a genuine chunky-pixel look. Just static files (`index.html`, `style.css`, `game.js`, `assets/`), so it deploys as-is to GitHub Pages / Cloudflare Pages / any static host.

## Art credit

Character sprites are the free "Brawler Series" (Ranger & Renegade rigs) by **chasersgaming**, CC0-licensed, from [OpenGameArt.org](https://opengameart.org/content/brawler-asset-character-ranger-sms) — explicitly built in the Double Dragon / Streets of Rage mold. Recolored via canvas filters to differentiate the three playable hosts and enemy roster. No attribution is legally required under CC0, but it's credited here anyway. Everything else (levels, boss, backgrounds, UI, game logic) is original.
