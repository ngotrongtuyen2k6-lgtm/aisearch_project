# Verity: AI-content verification MVP

The project keeps the existing public React client and protected Express Admin API, and adds a standalone Python FastAPI Image MVP. Express continues to handle the legacy audio/document flow; image uploads from the Client use FastAPI on port `8000`.

## Run locally

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Configure `GEMINI_API_KEY`, `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD_HASH`.
4. Install and start:

   ```powershell
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173`. Express listens on `http://localhost:3001`.

Install the Image API runtime and dependencies once:

```powershell
python -m venv image_api\.venv
image_api\.venv\Scripts\Activate.ps1
python -m pip install -r image_api\requirements.txt
```

In another terminal, run FastAPI:

```powershell
npm run dev:image-api
```

The image API is available at `http://localhost:8000`; its interactive API schema is at `/docs`.

Generate an admin password hash locally. The script masks input and prints only the bcrypt hash:

```powershell
npm run hash-password --workspace server
```

Set the printed hash as `ADMIN_PASSWORD_HASH` and configure `ADMIN_USERNAME` and a long random `JWT_SECRET` in `.env`. Admin routes are `/admin/login`, `/admin`, and `/admin/prompts`; the public client does not link to them. Admin login allows at most five failed attempts per IP per 15 minutes; successful login clears that failure counter. JWT sessions expire after two hours. In production, build the client with `npm run build`, then run `npm start`; Express serves `client/dist`.

## Verification behavior

- Image flow uses FastAPI endpoints: `POST /upload`, `GET /jobs/{id}`, `GET /results/{id}`, `POST /results/{id}/dispute`, and `DELETE /files/{id}`. Uploads are streamed with a 10 MB default cap, validated against actual image format, declared MIME type, and extension, then deleted in a `finally` block after analysis. The FastAPI upload limit is five requests per minute per IP; at most two jobs run and six wait.
- The Image result follows the shared H1 JSON shape (`file_type`, `ai_generated`, `edited`, `evidence`, `limitations`, `language_supported`). Missing AI detector scores are `null`, not invented values. Confidence is High only when a configured model and verified provenance corroborate the AI claim; Low confidence yields `Inconclusive`.
- EXIF inspection reports software/camera/timestamp observations; JPEG ELA produces a heatmap and a clearly labeled heuristic signal. Neither ELA nor metadata proves manipulation. Optional `IMAGE_AI_DETECTOR_URL` and `C2PA_VERIFY_URL` providers are called only when configured. Their documented contracts are a multipart `file` request returning `{ "score": 0..100, "confidence": "Low|Medium|High" }` and `{ "verified": true|false, "claim": "...", "summary": "..." }`, respectively.
- Completed image results are cached by SHA-256 for 24 hours (up to 128 entries). Job state and disputes are held in memory; job/cache state expires and disputes are capped at 10,000 records. Use shared persistent storage before multi-instance or production deployment.
- `POST /api/verify` accepts `image`, `audio`, or `document` with a multipart `file`; document verification also accepts pasted `text`.
- Gemini receives the dynamic system prompt stored in the local JSON data file. Responses must match a validated JSON schema; missing configuration, provider failures, and malformed responses return explicit errors rather than sample scores.
- Uploads are processed in memory and never written to disk; request buffers are released in `finally` after analysis. Images are limited to 5 MB, audio to 15 MB, and documents to 10 MB. MIME type and filename extension must both be supported.
- `POST /api/verify` allows at most five requests per minute per IP. Admin can reduce this limit to 1–5 in the fixed 60-second window. AI work is limited to three active analyses and six queued requests; excess requests receive HTTP 503. Provider calls time out after 30 seconds.
- Analysis metadata is retained for seven days and capped at the latest 10,000 records. Rate-limit counters use bounded in-memory buckets; failed Admin login counters and prompts are stored in JSON. Synchronous, atomic JSON updates serialize writes in this single-process server; use a shared database and gateway rate limiter before running multiple server instances.
- `/api/admin/login` issues an HttpOnly, SameSite=Strict JWT cookie. Other Admin endpoints require it. Configure HTTPS in production so the cookie is Secure.
- Admin settings, prompts, recent analysis metadata and failed-login counters are stored in `server/data/verity.json` by default. If deployed behind a reverse proxy, set `TRUST_PROXY=1` only when the proxy is controlled and configured to overwrite forwarded IP headers.

The output is indicative, not proof. AI probabilities and evidence summaries are not legal findings and need independent verification.

Run the Image MVP tests with `npm run test:image-api` (or `python -m pytest` from `image_api`).
