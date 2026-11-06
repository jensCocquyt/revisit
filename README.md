# Revisit

Save anything worth coming back to, and find it again from a vague memory.

## The idea

Everything you save is an **item**: a link, a piece of text, a screenshot. Saving is instant; understanding happens afterwards. Nothing is organized by hand.

Each item becomes searchable text plus meaning:

- **Link**: the page content is kept at save time, so search survives the page changing or disappearing.
- **Text**: itself.
- **Screenshot**: the text in it, plus a description of what it shows.
- **Note** (optional): one line on why you saved it.

## Search

One search box that matches both ways at once:

- **By meaning**: "that piece about burnout in remote teams" finds it without those words, across languages.
- **Exactly**: names, error codes, URLs, quotes.

Results show a snippet with the matching words highlighted, or a thumbnail, and can be narrowed by type and time.

The bar: something saved weeks ago is found from a vague description in seconds.

## Scope

Single user. Saving starts from a web page. Content comes in multiple languages.

## Running it

Needs Node 24, Docker, and AWS credentials that can call Bedrock in eu-west-1: Cohere Embed v4 for search, and a Claude model for reading screenshots.

Signing in needs a Google OAuth client. In the Google Cloud console, under Google Auth Platform: keep the app in Testing with your own account as a test user, allow the `openid` and `email` scopes, and create a Web application client with `http://localhost:3000/auth/callback` and `http://localhost:5173/auth/callback` as redirects. Put its ID and secret, your email and a random session secret (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) in `.env`.

```bash
cp .env.example .env
docker compose up -d postgres
cd web && npm ci && npm run build
cd ../server && npm ci && npm run build && npm start
```

Then open http://localhost:3000. For development, run `npm run dev` in both `server/` and `web/`, set `APP_URL=http://localhost:5173` and open that URL; Vite forwards `/api` and `/auth` to the server.

Checks, from `server/` (tests and eval each wipe their own database, set in `.env`):

```bash
npm test
npm run eval
```

The eval loads a small mixed-language corpus through real Bedrock and reports how many vague queries find their item in the top 5.

## Roadmap

1. Save and search links, text and screenshots, running locally.
2. Online, with a single-user login.
3. "More like this" on any item.
4. Grouping: related items gathered into piles you can name.

Not planned for now: tags, summaries, deadlines, accounts.

An earlier, heavier version lives in git history before the October 2026 restart.
