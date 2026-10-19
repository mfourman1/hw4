# Campus Customs Shop + Chatbot (MGT 409, Homework 4)

A website for Campus Customs, a Yale apparel shop at 57 Broadway, New Haven, with a chat
assistant ("Handsome Dan") that looks up products, prices, and stock in the shop's database.

- **Front end:** React + Vite + TypeScript (`frontend/`).
- **Back end:** FastAPI with a PydanticAI agent (`backend/`).
- **Database:** SQLite.

How the system works (data types, tools, safety rules, audit trail, and limits) is
explained in [`output/harness.md`](output/harness.md).

## What's in this folder

```
hw4/
├── AI_prompts.md         # the prompts I typed for each problem
├── requirements.txt      # Python packages for the back end
├── .env.example          # settings with placeholders (copy to .env)
├── .gitignore            # keeps .env, the database, and product photos out of git
├── README.md
├── frontend/             # Vite React TypeScript app
├── backend/
│   ├── main.py           # FastAPI app: uvicorn main:app --reload --port 8000
│   ├── agent.py          # the agent: prompts/prompt.md + agent.py + tools.py + models.py
│   ├── models.py
│   ├── tools.py
│   ├── prompts/prompt.md
│   ├── safety.py, audit.py, privacy.py, shop.py, auth.py, ...   # safety rules, audit trail, shop logic
│   └── evals/            # tests for search, privacy, shopping features, and safety
├── output/
│   ├── harness.md        # how the system works
│   ├── design.md         # the site design and why it sells
│   ├── usability.md      # wishlist, cart, embroidery, privacy, and search improvements
│   ├── app_check.html    # live site check with screenshots (app_check_images/)
│   └── audit_trail.json  # append-only record of every chat turn
└── tests/app_check.mjs   # the script that ran the live site check
```

The **data pack is not in git**: the database and product photos stay on your computer.

## Run it

You need:
- Python 3.12 or newer;
- Node.js 20.19 or newer;
- a Portkey API key.

### 1. Place the data pack

Unzip the course's `data.zip` so this folder has:

```
hw4/data/
├── campus_customs.db
└── products/            # the product photos the catalogue refers to
```

The first time the back end starts, it adds its own tables to the database: sessions,
wishlist, cart, saved designs, and shared wishlists.

Optional: to show the photos that have black side bars on white instead, run this once
(it writes cleaned copies to `data/products_clean/`):

```
cd backend
python scripts/clean_photos.py
```

### 2. Add your API key

Copy `.env.example` to `.env` (in this folder) and put in your Portkey key:

```
PORTKEY_API_KEY=your-portkey-key-here
OPENAI_MODEL=gpt-5.6-luna
```

`.env` is ignored by git. Without a key, the site still works; only the chat says it's
unavailable.

### 3. Start the back end (port 8000)

```
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. Start the front end (port 5173)

In a second terminal:

```
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server forwards `/api` and `/images` to the
back end, so both must be running.

- **Try it on (phones):** to use the try-on camera on a phone, run `npm run dev:phone`
  instead. It serves the site over HTTPS on your local network.
- **Build:** `npm run build` makes a production build in `frontend/dist/`.

## Tests

From `backend/` (with the data pack in place):

```
python evals/search_eval.py      # search finds what shoppers mean (22 cases)
python evals/privacy_eval.py     # card numbers, passwords, etc. are hidden (42 checks)
python evals/shopping_eval.py    # fit finder, sold-out alternatives, group orders, share links (32 checks)
python evals/safety_eval.py      # safety rules and audit trail (57 checks; add --live for 8 real agent conversations)
```

From `hw4/`, with both servers running: `node tests/app_check.mjs` reruns the live site
check in Microsoft Edge and saves the screenshots for `output/app_check.html`.
