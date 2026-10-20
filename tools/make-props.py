"""
Builds the game's default content (EN + FR) from this file and tools/tracks.json:
  content/props.json         local model paths (/models/*.glb) for `npm run dev`
  game/src/dev-props.json    same, read by the local dev entry
  content/props.edverse.json CDN model URLs (when content/asset-urls.json exists)

  python3 tools/make-props.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = json.load(open(os.path.join(ROOT, "tools", "tracks.json")))


def L(en, fr=None):
    return {"en": en, "fr": fr if fr is not None else en}


def q(cid, k, prompt, answers, explain=None):
    """answers[0] is the right one (the game shuffles the boxes)."""
    if isinstance(prompt, str):
        prompt = L(prompt)
    ans = [L(str(a)) for a in answers]
    if explain is None:
        explain = {lang: f"{prompt[lang]} = {answers[0]}" for lang in ("en", "fr")}
    return {"id": f"{cid}-q{k + 1}", "prompt": prompt, "answers": ans, "correct": 0, "explain": explain}


M = "−"  # minus sign

CUPS = [
    {
        "id": "sunny-sums",
        "name": L("Sunny Sums", "Additions au soleil"),
        "topic": L("Adding and taking away to 100", "Additions et soustractions jusqu'à 100"),
        "mood": "day",
        "ground": "#7fbf5a",
        "track": "c1",
        "boosts": [0.3, 0.7],
        "qs": [
            ("8 + 7", [15, 14, 16]),
            (f"13 {M} 5", [8, 7, 18]),
            ("24 + 9", [33, 23, 32]),
            (f"40 {M} 18", [22, 28, 32]),
            ("36 + 27", [63, 53, 64]),
            (f"50 {M} 7", [43, 47, 57]),
            ("19 + 19", [38, 28, 39]),
            (f"72 {M} 30", [42, 45, 102]),
            ("45 + 45", [90, 80, 95]),
            (f"61 {M} 26", [35, 45, 37]),
            ("7 + 8 + 3", [18, 17, 21]),
            (f"100 {M} 45", [55, 65, 45]),
        ],
    },
    {
        "id": "times-table-trail",
        "name": L("Times-Table Trail", "Le circuit des tables"),
        "topic": L("Times tables up to 12", "Tables de multiplication jusqu'à 12"),
        "mood": "morning",
        "ground": "#9fb85c",
        "track": "c2",
        "boosts": [0.38, 0.78],
        "qs": [
            ("3 × 4", [12, 7, 16]),
            ("6 × 7", [42, 36, 48]),
            ("8 × 5", [40, 45, 13]),
            ("9 × 3", [27, 12, 24]),
            ("7 × 8", [56, 54, 64]),
            ("4 × 9", [36, 32, 13]),
            ("6 × 6", [36, 12, 32]),
            ("10 × 7", [70, 17, 107]),
            ("9 × 9", [81, 18, 72]),
            ("8 × 4", [32, 12, 28]),
            ("5 × 12", [60, 17, 50]),
            ("7 × 7", [49, 14, 42]),
        ],
    },
    {
        "id": "division-dunes",
        "name": L("Division Dunes", "Les dunes de la division"),
        "topic": L("Sharing and dividing", "Partager et diviser"),
        "mood": "sunset",
        "ground": "#d8b878",
        "track": "c3",
        "boosts": [0.25, 0.58],
        "qs": [
            ("12 ÷ 3", [4, 9, 36]),
            ("20 ÷ 4", [5, 16, 4]),
            ("35 ÷ 5", [7, 6, 30]),
            ("42 ÷ 6", [7, 8, 36]),
            ("54 ÷ 9", [6, 5, 45]),
            ("64 ÷ 8", [8, 7, 56]),
            ("28 ÷ 7", [4, 21, 3]),
            ("81 ÷ 9", [9, 8, 72]),
            ("48 ÷ 6", [8, 6, 42]),
            ("100 ÷ 10", [10, 90, 1]),
            ("72 ÷ 8", [9, 8, 64]),
            (L("Half of 18", "La moitié de 18"), [9, 36, 8]),
        ],
    },
    {
        "id": "mixed-moonlight",
        "name": L("Mixed Moonlight", "Calculs au clair de lune"),
        "topic": L("Mixed operations: × and ÷ come first", "Calculs mélangés : × et ÷ d'abord"),
        "mood": "night",
        "ground": "#3f6347",
        "track": "c4",
        "boosts": [0.2, 0.52, 0.8],
        "qs": [
            ("2 + 3 × 4", [14, 20, 24], L("× first: 3 × 4 = 12, then 2 + 12 = 14", "× d'abord : 3 × 4 = 12, puis 2 + 12 = 14")),
            (L("Double 35", "Le double de 35"), [70, 37, 65]),
            (f"9 × 6 {M} 4", [50, 18, 58], L("9 × 6 = 54, then 54 − 4 = 50", "9 × 6 = 54, puis 54 − 4 = 50")),
            (f"100 {M} 4 × 5", [80, 480, 90], L("× first: 4 × 5 = 20, then 100 − 20 = 80", "× d'abord : 4 × 5 = 20, puis 100 − 20 = 80")),
            ("18 ÷ 3 + 7", [13, 25, 6], L("÷ first: 18 ÷ 3 = 6, then 6 + 7 = 13", "÷ d'abord : 18 ÷ 3 = 6, puis 6 + 7 = 13")),
            ("(3 + 5) × 2", [16, 13, 10], L("Brackets first: 3 + 5 = 8, then 8 × 2 = 16", "Parenthèses d'abord : 3 + 5 = 8, puis 8 × 2 = 16")),
            (L("Half of 150", "La moitié de 150"), [75, 50, 300]),
            ("7 × 8 + 2", [58, 70, 56], L("7 × 8 = 56, then 56 + 2 = 58", "7 × 8 = 56, puis 56 + 2 = 58")),
            ("45 ÷ 5 × 2", [18, 9, 20], L("Left to right: 45 ÷ 5 = 9, then 9 × 2 = 18", "De gauche à droite : 45 ÷ 5 = 9, puis 9 × 2 = 18")),
            (f"6 × 6 {M} 6", [30, 0, 36], L("6 × 6 = 36, then 36 − 6 = 30", "6 × 6 = 36, puis 36 − 6 = 30")),
            (f"1000 {M} 1", [999, 900, 990]),
            ("12 × 3", [36, 15, 33]),
        ],
    },
]

UI = {
    "play": L("Play", "Jouer"),
    "howToPlay": L("How to play", "Comment jouer"),
    "howSteps": [
        L("Your kart drives by itself: you steer.", "Ton kart avance tout seul : tu tournes le volant."),
        L("Before each row of boxes, a question appears. Every box carries one answer.", "Avant chaque rangée de boîtes, une question apparaît. Chaque boîte porte une réponse."),
        L("Drive through the box with the right answer to win a random bonus.", "Passe dans la boîte de la bonne réponse pour gagner un bonus surprise."),
        L("A wrong box makes your kart spin and slow down. Try again on the next lap!", "Une mauvaise boîte fait tourner ton kart et le ralentit. Réessaie au tour suivant !"),
        L("Collect coins to go a little faster. Finish in the top 3 to win a trophy!", "Ramasse des pièces pour aller un peu plus vite. Termine dans les 3 premiers pour gagner une coupe !"),
    ],
    "controlsKeys": L(
        "← → or A D: steer · ↓ or S: brake · Shift: drift (hold in a turn, let go for a boost) · Space or E: use your bonus · Esc: pause",
        "← → ou Q D : tourner · ↓ ou S : freiner · Maj : dérapage (tiens-le dans un virage, lâche pour un boost) · Espace ou E : utiliser le bonus · Échap : pause",
    ),
    "controlsTouch": L(
        "◀ ▶: steer · Brake: slow down · Drift: hold in a turn, let go for a boost · Tap the bonus box at the top to use it",
        "◀ ▶ : tourner · Frein : ralentir · Dérapage : tiens-le dans un virage, lâche pour un boost · Touche la case bonus en haut pour l'utiliser",
    ),
    "bonusesTitle": L("Bonuses", "Les bonus"),
    "back": L("Back", "Retour"),
    "loading": L("Warming up the engines…", "Les moteurs chauffent…"),
    "chooseCup": L("Choose a cup", "Choisis une coupe"),
    "lockedHint": L("Finish the cup before", "Termine la coupe d'avant"),
    "notRaced": L("Not raced yet", "Pas encore courue"),
    "laps": L("laps", "tours"),
    "chooseRacer": L("Choose your racer", "Choisis ton pilote"),
    "start": L("Start!", "C'est parti !"),
    "lap": L("Lap", "Tour"),
    "finalLap": L("Final lap!", "Dernier tour !"),
    "go": L("GO!", "PARTEZ !"),
    "question": L("Question", "Question"),
    "useBonus": L("Use bonus", "Utiliser le bonus"),
    "coins": L("Coins", "Pièces"),
    "drift": L("Drift", "Dérapage"),
    "brake": L("Brake", "Frein"),
    "left": L("Left", "Gauche"),
    "right": L("Right", "Droite"),
    "correct": L("Right! Bonus!", "Bravo ! Bonus !"),
    "wrong": L("Oops!", "Oups !"),
    "answerWas": L("The answer was", "La réponse était"),
    "missed": L("Missed the boxes!", "Tu as raté les boîtes !"),
    "missedShort": L("missed", "ratée"),
    "shielded": L("Shield saved you!", "Le bouclier t'a protégé !"),
    "hitPeel": L("Slippery peel!", "Peau glissante !"),
    "hitNova": L("Bumped by a nova!", "Percuté par une nova !"),
    "finish": L("Finish!", "Arrivée !"),
    "paused": L("Paused", "Pause"),
    "resume": L("Resume", "Reprendre"),
    "restart": L("Restart", "Recommencer"),
    "quit": L("Quit race", "Quitter la course"),
    "sound": L("Sound", "Son"),
    "quality": L("Graphics", "Graphismes"),
    "qualityLow": L("Fast", "Rapide"),
    "qualityHigh": L("Pretty", "Joli"),
    "on": L("On", "Oui"),
    "off": L("Off", "Non"),
    "podium": L("On the podium!", "Sur le podium !"),
    "keepGoing": L("Nice race! Try again for a trophy", "Belle course ! Réessaie pour une coupe"),
    "newBest": L("New best!", "Record !"),
    "rightAnswers": L("right answers", "bonnes réponses"),
    "standings": L("Race results", "Classement"),
    "yourAnswers": L("Your answers", "Tes réponses"),
    "retry": L("Race again", "Rejouer"),
    "nextCup": L("Next cup", "Coupe suivante"),
    "familyBoard": L("Family best times", "Meilleurs temps de la famille"),
    "guestHint": L("Sign in on EdVerse to compare times with your family.", "Connecte-toi sur EdVerse pour comparer tes temps avec ta famille."),
    "boardEmpty": L("No times yet: be the first!", "Pas encore de temps : sois le premier !"),
    "ordinals": [L("1st", "1er"), L("2nd", "2e"), L("3rd", "3e"), L("4th", "4e"), L("5th", "5e")],
}

BONUSES = {
    "turbo": {"name": L("Turbo", "Turbo"), "hint": L("A big burst of speed.", "Une grosse poussée de vitesse.")},
    "triple": {"name": L("Triple turbo", "Triple turbo"), "hint": L("Three bursts: use them one by one.", "Trois poussées, à utiliser une par une.")},
    "shield": {"name": L("Bubble shield", "Bouclier bulle"), "hint": L("Protects you from one spin: a peel, a bump or a wrong box.", "Te protège d'une glissade : une peau, un choc ou une mauvaise boîte.")},
    "peel": {"name": L("Banana peel", "Peau de banane"), "hint": L("Drop it behind you: rivals who drive over it spin.", "Lâche-la derrière toi : les rivaux qui roulent dessus glissent.")},
    "coins": {"name": L("Coin bag", "Sac de pièces"), "hint": L("Five coins at once: coins make you faster.", "Cinq pièces d'un coup : les pièces te rendent plus rapide.")},
    "nova": {"name": L("Super nova", "Super nova"), "hint": L("Shine for a few seconds: faster, and rivals bounce off you.", "Brille quelques secondes : plus rapide, et les rivaux rebondissent sur toi.")},
}

RACERS = [
    {"name": L("Oobi"), "color": "#8c78ff"},
    {"name": L("Oodi"), "color": "#ff7aa2"},
    {"name": L("Ooli"), "color": "#ffb02e"},
    {"name": L("Oopi"), "color": "#3fd6b8"},
    {"name": L("Oozi"), "color": "#e8dcc8"},
]

ASSET_FILES = {
    "karts": ["kart_oobi", "kart_oodi", "kart_ooli", "kart_oopi", "kart_oozi"],
    "itemBox": "item_box",
    "banana": "banana",
    "coin": "coin",
    "cone": "cone",
    "tree": "tree",
    "treePine": "tree_pine",
    "smoke": "smoke",
    "debrisTire": "debris_tire",
    "gantry": "question_gantry",
    "startArch": "start_arch",
    "boostPad": "boost_pad",
    "tireWall": "tire_wall",
    "grandstand": "grandstand",
    "flag": "flag",
}


def suggest_rows():
    """Rows from tools/check-tracks.mjs output (straightest stretches), cached in tracks.json."""
    import subprocess

    out = subprocess.run(["node", os.path.join(ROOT, "tools", "check-tracks.mjs"), os.path.join(ROOT, "tools", "tracks.json")], capture_output=True, text=True, cwd=ROOT).stdout
    rows = {}
    for line in out.splitlines():
        if "rows=" in line:
            cid = line.split()[1].rstrip(":")
            rows[cid] = json.loads(line.split("rows=")[1])
    return rows


def assets(url_for):
    a = {}
    for k, v in ASSET_FILES.items():
        a[k] = [url_for(x) for x in v] if isinstance(v, list) else url_for(v)
    return a


def build(url_for):
    rows = suggest_rows()
    cups = []
    for c in CUPS:
        t = TRACKS[c["track"]]
        qs = []
        for k, item in enumerate(c["qs"]):
            prompt, answers = item[0], item[1]
            explain = item[2] if len(item) > 2 else None
            qs.append(q(c["id"], k, prompt, answers, explain))
        cups.append(
            {
                "id": c["id"],
                "name": c["name"],
                "topic": c["topic"],
                "mood": c["mood"],
                "ground": c["ground"],
                "laps": 3,
                "width": 16,
                "points": t["points"],
                "rows": rows.get(c["track"], [0.3, 0.62, 0.86]),
                "boosts": c["boosts"],
                "questions": qs,
            }
        )
    return {
        "title": L("Quiz Kart Rally", "Quiz Kart Rally"),
        "subtitle": L("The right answer is the fastest line!", "La bonne réponse, c'est la meilleure trajectoire !"),
        "cups": cups,
        "racers": RACERS,
        "bonuses": BONUSES,
        "ui": UI,
        "assets": assets(url_for),
        "boardPrefix": "cup",
    }


def main():
    local = build(lambda n: f"/models/{n}.glb")
    for p in ("content/props.json", "game/src/dev-props.json"):
        with open(os.path.join(ROOT, p), "w") as f:
            json.dump(local, f, ensure_ascii=False, indent=1)
        print("wrote", p)
    urls_path = os.path.join(ROOT, "content", "asset-urls.json")
    if os.path.exists(urls_path):
        urls = json.load(open(urls_path))
        cdn = build(lambda n: urls[n])
        with open(os.path.join(ROOT, "content", "props.edverse.json"), "w") as f:
            json.dump(cdn, f, ensure_ascii=False, indent=1)
        print("wrote content/props.edverse.json")


main()
