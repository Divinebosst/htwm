# Heal The World Ministries International — website

Church website for **Heal The World Ministries International (Omega Family Church)**.

| Part | Built with | What it does |
|---|---|---|
| `frontend/` | Next.js 16 (React, TypeScript) | The public website (home page with upcoming events, events pages, giving page, prayer request form) and the **staff admin** at `/admin` |
| `backend/` | Django 5.2 + Django REST Framework | The API, staff sign-in, roles and permissions, and the audit log |

```
Visitor ─────► Next.js website ──(/api/*)──► Django API ──► database
Church staff ─► /admin pages ────┘                │
                                                  └─► audit log (every sign-in and change)
```

## The staff admin (`/admin`)

Staff sign in at **`/admin`** on the website (for example `http://localhost:3000/admin`). What they see depends on their role.

### Roles

| | System Admin | Admin | Pastor | Caretaker |
|---|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Add and edit events (with pictures) | ✓ | ✓ | ✓ | ✓ |
| Edit service times | ✓ | ✓ | ✓ | ✓ |
| Read prayer requests | ✓ | ✓ | ✓ | |
| Read **private** prayer requests | ✓ | | ✓ | |
| Update prayer requests (status, notes) | ✓ | | ✓ | |
| See gifts | ✓ | ✓ | ✓ | |
| Change a gift's status by hand (rarely needed: online gifts confirm themselves) | ✓ | ✓ | | |
| Edit giving categories | ✓ | ✓ | | |
| See church settings / edit contact details | ✓ | ✓ | | |
| Edit the **giving currency** and quick-pick amounts | ✓ | | | |
| Manage staff accounts | All roles | Pastors and Caretakers | | |
| Read the audit log | ✓ | ✓ | | |

The rules live in one file, `backend/accounts/roles.py`. The API checks them on every request, so hiding a menu item is never the only protection. Some choices worth knowing:

- **Private prayer requests** are only shown to Pastors and System Admins, because the prayer form promises "only the pastors and prayer team will read it".
- **Where money goes** can't be changed in the admin at all: the PayPal and Paynow accounts are connected on the server (see [Online giving](#online-giving-paypal-and-mobile-money)), so a stolen staff password can't redirect the church's money. The giving currency can only be changed by a System Admin, and every change is logged with the old and new values.
- **Accounts are switched off, never deleted**, so the audit log always says who did what. Nobody can change their own role, and the last active System Admin can't be removed.

### Audit log

The audit log records every sign-in, failed sign-in, sign-out, password change or reset, refused access attempt, and every create, change and delete of events, service times, settings, giving categories, gifts, prayer requests and staff accounts. Each entry has who did it (and their role at the time), when, from which IP address and device, and what changed (before and after).

- Entries **can't be edited or deleted** by anyone, through the admin or the code.
- Personal details stay out of the log: for prayer requests only the type, privacy flag and status are recorded, never the name, contact or message.
- Changes made on the public website (prayer requests) are logged as "Public website". Payments confirmed by PayPal or Paynow are logged as "Online payments", and unfinished payments closed after a day as "System".

### Other protections

- Sessions end after 4 hours without activity (`DJANGO_SESSION_SECONDS`).
- Sign-in is limited to 8 attempts a minute and 40 an hour per address.
- New accounts and password resets get a **temporary password**, shown once. The person must choose their own password before they can do anything else.
- All changes need Django's CSRF token, and the session cookie can't be read by scripts.

### First sign-in

Create the first System Admin on the server:

```bash
cd backend
python manage.py createsuperuser
```

Sign in at `/admin` with it, then add everyone else under **Staff accounts**.

Django's own built-in admin is still available at `/django-admin/` on the backend, for System Admins only, as a fallback.

## Run it on your computer

You need **Python 3.12+** and **Node.js 20+**.

### 1. Backend (Django)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # your System Admin login
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

Open http://localhost:3000 for the website and http://localhost:3000/admin for the staff admin.

## Before going live: fill these in

1. **Online giving**: connect the church's PayPal and Paynow accounts (see [Online giving](#online-giving-paypal-and-mobile-money)). Until then the giving page says each option is being set up.
2. **Service times**: the sample times (Sunday 10:00 AM, Wednesday 5:30 PM, Friday 6:00 PM) are made up.
3. **Events**: replace the sample events with real ones.
4. **Phone numbers**: the flier shows `0770772105160`, which has too many digits. Please confirm it.
5. **WhatsApp number**: set to `263775856800` (0775 856 800 with Zimbabwe's code). Prayer requests that fail to send go here.
6. **Time zone**: event times are shown in `Africa/Harare`. Change `DJANGO_TIME_ZONE` if the church is elsewhere.
7. **Photos**: the logo was cut from the flier. Replace `frontend/src/assets/logo.png` with a sharper original. The leaders' photo is `frontend/src/assets/leaders.jpg`.

Edits made in the admin show on the website straight away. A single event's own page may show the old version for one more page load while it rebuilds; everything updates within a minute at most.

## Online giving (PayPal and mobile money)

The giving page takes money in two ways. Both confirm themselves, so nobody has to check statements or ask givers for proof:

| Option | How the giver pays | How it's confirmed |
|---|---|---|
| **PayPal** (shown first) | PayPal's own buttons: a PayPal account, or **Debit or Credit Card** without one | The server takes the payment through PayPal and marks the gift received |
| **Mobile money** | Tap **EcoCash**, **InnBucks**, **O'mari** or **OneMoney** and enter their number. EcoCash and OneMoney pop up a PIN prompt on the phone; InnBucks gives a code to approve in the InnBucks app; O'mari texts a one-time code to type on the page | Paynow tells the server when it's paid, and the page checks every few seconds |

As soon as the money arrives the page shows a thank-you message with a gift number, and the gift shows as **Received** in the admin. The amount is set by the server, not the browser, and a gift only counts once PayPal or Paynow confirms the full amount. Payments someone starts but never finishes are closed after a day. **Church settings** in the admin shows whether each option is connected.

### Connect PayPal

1. Sign in to [developer.paypal.com](https://developer.paypal.com/dashboard/applications) with the church's PayPal **business** account and create an app under **Apps & Credentials**.
2. On the backend server set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MODE=sandbox`, then make a test gift with a sandbox buyer account.
3. Switch to the **Live** credentials and set `PAYPAL_MODE=live`.

### Connect mobile money (Paynow)

1. In the church's [Paynow](https://www.paynow.co.zw) account, create an integration in the giving currency (USD). Paynow sends an **integration ID** and **integration key**. Ask Paynow to switch on each wallet you want (EcoCash, OneMoney, InnBucks, O'mari).
2. On the backend server set `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, `PAYNOW_AUTH_EMAIL` (the email you sign in to Paynow with) and `SITE_URL` (the public website address, e.g. `https://www.healtheworldministries.com`). Paynow sends payment updates to `SITE_URL/api/payments/paynow/result`, so it must be reachable from the internet.
3. While the integration is in test mode, these numbers simulate a payment: `0771111111` succeeds, `0772222222` succeeds after a delay, `0773333333` is cancelled, `0774444444` fails for low balance. Then ask Paynow to make the integration live.

All of these go in `backend/.env` (see `backend/.env.example`) or the host's environment settings. Restart the backend after changing them. The keys are never stored in the database or shown in the admin.

The wallet logos are in `frontend/public/payments/`. The EcoCash and OneMoney files are small copies from Paynow's website; replace them with the official logo files (same names) for a sharper look.

## Putting it online

### Recommended: one server, one domain

Run both parts on one server behind a web server that handles HTTPS, such as Caddy or nginx. It sends `/api`, `/media`, `/static` and `/django-admin` to Django and everything else to Next.js. Example Caddy configuration (adjust the domain):

```
www.healtheworldministries.com {
    @django path /api/* /media/* /static/* /django-admin/*
    reverse_proxy @django 127.0.0.1:8000
    reverse_proxy 127.0.0.1:3000
}
```

Backend:

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
gunicorn config.wsgi --bind 127.0.0.1:8000
```

with these environment variables (see `backend/.env.example`):

| Variable | Value |
|---|---|
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECRET_KEY` | a long random value |
| `DJANGO_ALLOWED_HOSTS` | `www.healtheworldministries.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://www.healtheworldministries.com` (staff can't sign in without it) |
| `DJANGO_PROXY_COUNT` | `1` (see below) |

Frontend: `DJANGO_API_URL=http://127.0.0.1:8000` and `SITE_URL=https://www.healtheworldministries.com`, then `npm run build && npm start`. Set them **before** building, with the backend running, so the pages are built with real content.

The database is SQLite in `backend/db.sqlite3`. Keep it on a persistent disk and back it up, along with `backend/media/` (event pictures).

### Frontend on Vercel, backend on another host

If the website runs on Vercel (e.g. `https://htwm.vercel.app`) and Django runs elsewhere:

| Where | Variable | Value |
|---|---|---|
| Vercel | `DJANGO_API_URL` | the backend's public address, e.g. `https://htwm-api.onrender.com` |
| Vercel | `SITE_URL` | your custom domain once you have one, e.g. `https://www.healtheworldministries.com`. Link previews use it; without it they use the Vercel address |
| Backend | `DJANGO_ALLOWED_HOSTS` | the backend's own host, e.g. `htwm-api.onrender.com` |
| Backend | `DJANGO_CSRF_TRUSTED_ORIGINS` | **every address the website is opened on**, comma separated, e.g. `https://htwm.vercel.app,https://www.healtheworldministries.com` |
| Backend | `DJANGO_PROXY_COUNT` | usually `2` |

If `DJANGO_CSRF_TRUSTED_ORIGINS` is missing an address, staff signing in from it see: *"Staff sign-in isn't allowed from this website address (…) yet."* Add the address and restart the backend.

### Link previews (WhatsApp, Facebook, X, LinkedIn, Telegram…)

Every page has Open Graph and X (Twitter) tags, so a shared link shows the church's name, a short description and a picture. The picture is the share card in `frontend/src/assets/share-card.jpg` (1200×630, the logo and name centred on royal blue, so WhatsApp on a computer, which shows only the middle square, still shows the whole logo); an event with its own photo uses that photo instead. Replace the file to change the card.

Apps remember a preview for a while. After changing the card, refresh it with the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) ("Scrape Again", which also updates WhatsApp and Instagram) and LinkedIn's [Post Inspector](https://www.linkedin.com/post-inspector/). To test a fresh preview straight away, share the link with something extra on the end, e.g. `https://htwm.vercel.app/?v=2`.

### Visitors' real IP addresses (`DJANGO_PROXY_COUNT`)

The audit log and the rate limits need each visitor's real address. Web servers like Caddy add it to the `X-Forwarded-For` header; `DJANGO_PROXY_COUNT` tells Django how many such servers sit in front of it, so it reads the right entry and ignores anything a visitor made up.

- One server behind Caddy or nginx: `1`.
- Frontend and backend on separate hosts (e.g. Vercel + Render): usually `2`.

Next.js's own `/api` pass-through does **not** add the address. Without a web server in front, as on your computer, the address in the log can be faked, which only matters on a live site. After going live, sign in once and check that the audit log shows your real IP address.

## API

Public:

| Method | Path | Returns |
|---|---|---|
| GET | `/api/settings` | Contact details and giving details |
| GET | `/api/services` | Weekly service times |
| GET | `/api/events` | Upcoming events. `?limit=3`, `?when=past` |
| GET | `/api/events/<slug>` | One event |
| GET | `/api/giving-categories` | Tithe, Offering, … |
| POST | `/api/payments/paypal/orders` | Starts a PayPal payment (called by the PayPal button) |
| POST | `/api/payments/paypal/orders/<order id>/capture` | Takes the PayPal payment once the giver approves it |
| POST | `/api/payments/mobile` | Sends a mobile money payment request to the giver's phone |
| POST | `/api/payments/mobile/<id>/otp` | O'mari: the one-time code from the SMS |
| GET | `/api/payments/<id>` | A payment's status (the page asks every few seconds while it waits) |
| POST | `/api/payments/paynow/result` | Paynow's payment updates (checked against Paynow's signature) |
| POST | `/api/prayer-requests` | Saves a prayer request |

Staff (session cookie + CSRF token; permissions as in the roles table):

| Path | What |
|---|---|
| `/api/auth/csrf`, `login`, `logout`, `me`, `roles`, `password` | Signing in and out, who am I, change own password |
| `/api/admin/dashboard` | Figures for the dashboard (only the parts your role may see) |
| `/api/admin/events`, `/events/<id>`, `/events/<id>/image` | Events and their pictures |
| `/api/admin/services`, `/services/<id>` | Service times |
| `/api/admin/prayer-requests`, `/<id>` | Prayer requests |
| `/api/admin/gifts`, `/gifts/<id>`, `/gifts/bulk` | Gifts, including marking many as received |
| `/api/admin/giving-categories`, `/<id>` | Giving categories |
| `/api/admin/settings` | Church settings |
| `/api/admin/users`, `/users/<id>`, `/users/<id>/reset-password` | Staff accounts |
| `/api/admin/audit` | Audit log with filters |

## Tests and checks

```bash
cd backend && python manage.py test              # 67 tests: API, every role, accounts, audit log, payments
cd frontend && npm run lint && npx tsc --noEmit  # code checks
```
