# Siri Shortcuts

Ask Siri about your gigs, and record payments and gigs by voice. It takes about 10 minutes on your iPhone, once.

**Never commit or share a token.** A token works like being signed in. If one leaks, revoke it in the app (Settings → Siri and Shortcuts) and make a new one.

## 1. Make a token

App → **Settings → Siri and Shortcuts → Make a token for Siri**. Keep "Read and change" (needed to record payments), tap **Make token**, then **Copy token**. It's shown only once. If you lose it, revoke it and make another.

The address below is the live app: `https://gigspree.in`.

## 2. Questions (read only)

Build one, then duplicate it for the others.

**"Next gig"**

1. Shortcuts app → **+** → name it **Next gig**.
2. Add **Get Contents of URL**:
   - URL: `https://gigspree.in/api/me/brief?what=next`
   - Tap the arrow → Method **GET** → **Headers** → add `Authorization` with the value `Bearer ` followed by your token (one space after Bearer).
3. Add **Get Dictionary Value** → Get **Value** for key `text` in _Contents of URL_.
4. Add **Speak Text** (or **Show Result**) with _Dictionary Value_.

Say "Hey Siri, next gig".

**The others:** long-press _Next gig_ → **Duplicate**, rename it, and change only the word after `what=`:

| Shortcut name   | `what=`      | Siri says                                         |
| --------------- | ------------ | ------------------------------------------------- |
| Gigs this week  | `week`       | your gigs in the next 7 days                      |
| Who owes me     | `owed_to_me` | played gigs where your share isn't fully paid     |
| Who do I owe    | `to_pay`     | gigs you manage where players still need paying   |
| Clients who owe | `to_collect` | gigs you manage where the client still owes money |

## 3. Record a payment (from a client)

1. New shortcut **Record payment**.
2. **Ask for Input**: Text, prompt "Which gig?".
3. **Get Contents of URL**: `https://gigspree.in/api/me/pick?q=` then insert _Provided Input_ at the end. GET, with the same `Authorization` header.
4. **Get Dictionary Value**: Value for key `choices` in _Contents of URL_. Rename the result (tap it → Rename) to **Gigs**.
5. **Choose from List**: _Gigs_, prompt "Which one?".
6. **Get Dictionary Value**: Value for key _Chosen Item_ in _Gigs_. Rename to **Gig ID**.
7. **Ask for Input**: Number, prompt "How much, in rupees?". Rename to **Amount**.
8. **Choose from Menu** with prompt "How was it paid?" and options `upi`, `cash`, `bank`, `cheque`. In each option add a **Text** action with that same word. After the menu, rename _Menu Result_ to **Method**.
9. **Show Alert**: "Record ₹*Amount* for _Chosen Item_?" with **Show Cancel Button** on. This is the confirm step: Cancel stops here.
10. **Get Contents of URL**:
    - URL `https://gigspree.in/api/gigs/` + _Gig ID_ + `/payments`
    - Method **POST**
    - Headers:
      - `Authorization`: `Bearer <token>`
      - `Idempotency-Key`: _Current Date_ (tap it → Date Format **ISO 8601**, Include Time on) — it stops a double tap recording twice
    - Request Body **JSON**:
      - `amount` (Number): _Amount_
      - `method` (Text): _Method_
      - `paid_on` (Text): _Current Date_ with Custom format `yyyy-MM-dd`
11. **Show Notification**: "Payment recorded".

## 4. Record a payout (to someone playing)

Same as **Record payment**, with these changes:

- After step 6 (_Gig ID_), add **Get Contents of URL** `…/api/me/pick?gig_id=` + _Gig ID_ (GET, Authorization header).
- Then **Get Dictionary Value** `choices` → rename it **People** → **Choose from List** _People_ ("Who?") → **Get Dictionary Value** _Chosen Item_ in _People_ → rename it **Person ID**.
- In the last request, the URL ends in `/payouts` instead of `/payments`, and the JSON body gains `person_id` (Text): _Person ID_.

## 5. Add a gig

1. New shortcut **Add gig**.
2. **Ask for Input**: Text "Gig name?" → rename **Title**.
3. **Ask for Input**: Date and Time "When?" → rename **When**.
4. **Ask for Input**: Text "Where?" → rename **Venue**.
5. **Ask for Input**: Number "Fee in rupees? (0 if not known)" → rename **Fee**.
6. **Show Alert**: "Add _Title_ on _When_?" with Cancel.
7. **Get Contents of URL**:
   - URL `https://gigspree.in/api/gigs`, Method **POST**
   - Headers: `Authorization` and `Idempotency-Key` as above
   - Request Body **JSON**:
     - `title` (Text): _Title_
     - `status` (Text): `confirmed`
     - `fee` (Number): _Fee_
     - `events` (Array) → add one **Dictionary** item containing:
       - `start_at` (Text): _When_ with Custom format `yyyy-MM-dd'T'HH:mm`
       - `venue_name` (Text): _Venue_
8. **Show Notification**: "Gig added".

## What the calls are

| Call                          | Token needs  | Returns                                     |
| ----------------------------- | ------------ | ------------------------------------------- |
| `GET /api/me/brief?what=…`    | read         | `{ text, items }`: `text` is ready to speak |
| `GET /api/me/pick?q=…`        | read         | `{ choices: { "Gig · Sat, 12 Dec": id } }`  |
| `GET /api/me/pick?gig_id=…`   | read         | `{ choices: { "Name": person_id } }`        |
| `POST /api/gigs/:id/payments` | read, change | the gig                                     |
| `POST /api/gigs/:id/payouts`  | read, change | the gig                                     |
| `POST /api/gigs`              | read, change | the new gig                                 |

Every change needs an `Idempotency-Key` header, and each shortcut asks before it changes anything. Times without an offset are India time. Tokens can't make or see tokens, turn the calendar feed on or off, or open the admin panel. Full API: `docs/api.md`.
