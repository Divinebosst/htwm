# Heal The World Ministries International — website

Church website for **Heal The World Ministries International (Omega Family Church)**.

| Part | Built with | What it does |
|---|---|---|
| `frontend/` | Next.js 16 (React, TypeScript) | The public website: home page with upcoming events, events pages, giving page, prayer request form |
| `backend/` | Django 5.2 + Django REST Framework | The API and an **admin panel** where church staff manage events, service times, payment details, gifts and prayer requests |

```
Visitor ──► Next.js website ──(/api/*)──► Django API ──► database
                                            ▲
Church staff ──► Django admin (/admin) ─────┘
```

## What church staff can do in the admin

Open the admin at `http://localhost:8000/admin` (or your live backend address) and log in.

- **Events**: add crusades, conferences and special services with dates, location, a summary, full details and an optional picture. Tick *featured* to show an event first on the home page. Past events move to the "Past events" list on their own.
- **Service times**: the weekly schedule shown on the home page.
- **Church settings**: phone numbers, WhatsApp number, links, and all giving details (EcoCash merchant code, bank account, card/PayPal link, details for gifts from abroad). Anything left empty shows on the giving page as "To be added".
- **Giving categories**: Tithe, Offering, Seed, Building fund and so on. Add a new one (for example a special project) and it appears on the giving page.
- **Gifts**: every time someone taps "I've sent my gift", a record is saved with the amount, method and payment reference (e.g. `TITHE-MOYO`). The finance team matches it against the EcoCash or bank statement, then selects it and chooses **Mark selected gifts as received**. The list shows the total received.
- **Prayer requests**: requests and testimonies from the website. Mark them as prayed for once the team has prayed.

Changes show on the website within about a minute.

## Run it on your computer

You need **Python 3.12+** and **Node.js 20+**.

### 1. Backend (Django)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # your admin login
python manage.py load_sample_content
python manage.py runserver
```

`load_sample_content` adds **example** service times and six **example** events so the site isn't empty. Edit or delete them in the admin, or remove them all with `python manage.py load_sample_content --clear`.

### 2. Frontend (Next.js)

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Before going live: fill these in (in the admin)

1. **Church settings → Giving**: EcoCash merchant code, bank details, card/PayPal link, and who collects money sent from abroad.
2. **Service times**: the sample times (Sunday 10:00 AM, Wednesday 5:30 PM, Friday 6:00 PM) are made up.
3. **Events**: replace the sample events with real ones.
4. **Phone numbers**: the flier shows `0770772105160`, which has too many digits. Please confirm it.
5. **WhatsApp number**: set to `263775856800` (0775 856 800 with Zimbabwe's code). Proof of payment and failed prayer requests go here.
6. **Time zone**: event times are shown in `Africa/Harare`. Change `DJANGO_TIME_ZONE` if the church is elsewhere.
7. **Photos**: the logo and photo were cut from the flier. Replace `frontend/src/assets/logo.png` and `apostles.jpg` with sharper originals.

## Putting it online

The two parts are hosted separately.

**Backend** (any Python host, e.g. Railway, Render, PythonAnywhere or a VPS):

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn config.wsgi --bind 0.0.0.0:8000
```

Set these environment variables (see `backend/.env.example`): `DJANGO_DEBUG=false`, a long random `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` (your backend domain) and `DJANGO_CSRF_TRUSTED_ORIGINS` (e.g. `https://api.healtheworldministries.com`). The database is SQLite in `backend/db.sqlite3`. Keep that file on a persistent disk and back it up, along with `backend/media/` (event pictures).

**Frontend** (Vercel, Netlify, or the same VPS with `npm run build && npm start`):

- `DJANGO_API_URL`: address of the live backend, e.g. `https://api.healtheworldministries.com`
- `SITE_URL`: the public website address, e.g. `https://www.healtheworldministries.com`

Set both **before** running `npm run build`, with the backend already running, so the pages are built with real content.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/settings` | Contact details and giving details |
| GET | `/api/services` | Weekly service times |
| GET | `/api/events` | Upcoming events. `?limit=3`, `?when=past` |
| GET | `/api/events/<slug>` | One event |
| GET | `/api/giving-categories` | Tithe, Offering, … |
| POST | `/api/gifts` | Records a gift: `category`, `amount`, `method` (`ecocash`, `bank`, `card`, `abroad`), `giver_name`, `giver_contact`, `anonymous`, `purpose` |
| POST | `/api/prayer-requests` | Saves a request: `name`, `contact`, `kind` (`prayer`, `testimony`, `counselling`), `message`, `is_private` |

The two POST endpoints are rate-limited per visitor (30 gifts / 10 prayer requests per hour) and the prayer form has a hidden spam trap.

## Tests and checks

```bash
cd backend && python manage.py test church       # 15 API tests
cd frontend && npm run lint && npx tsc --noEmit  # code checks
```
