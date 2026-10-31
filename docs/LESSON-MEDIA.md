# Lesson video + PDF upload, player aur PDF reader

Course ke andar ab **video upload**, **PDF upload**, **video player** aur
**inline PDF reader** hai. Ye note batata hai ki kaise use karna hai, kya limits
hain aur security kaise kaam karti hai.

## 1. Teacher ke liye (admin / developer)

1. **Admin → Modules & Lessons** (ya **Courses → course → Modules**).
2. Lesson ke saamne **🎬 Media** button dabayein.
3. Do row dikhengi:
   - **🎬 Lesson video** — MP4 / M4V / WebM / OGV. 200 MB tak (badalna ho to
     `.env` me `MAX_VIDEO_SIZE_MB`).
   - **📄 Lesson PDF** — sirf PDF. 25 MB tak (`MAX_PDF_SIZE_MB`).
4. **Choose file** → **Upload**. Progress bar dikhta hai; "Replace" se naya file,
   "Remove" se purana file delete.
5. Naya lesson banate waqt upload **lesson create hone ke baad** khulta hai —
   file ko kisi lesson row ka id chahiye hota hai, isliye lesson save karte hi
   Media window khud khul jaati hai.

Purane **Video URL** / **Resource URL** fields waise hi hain: YouTube/Vimeo link
daalna ho to wahi use karein, upload ki zarurat nahi.

## 2. Student ke liye

Lesson kholte hi:

- **Uploaded video** → HTML5 player (play/pause, seek, speed, fullscreen).
  Player 206 partial-content support karta hai, yani 1 ghante ka lecture beech
  se bhi chalaya ja sakta hai — poora file download hone ka wait nahi.
- **YouTube / Vimeo link** → `youtube-nocookie.com` / Vimeo embed player.
- **Uploaded PDF** → lesson page ke andar hi inline reader (browser ka apna PDF
  engine), saath me **Open in new tab** aur **Download**.
- Jo link kisi known player ka nahi hai, wahan sirf "open link" milta hai —
  fake/blank player nahi dikhaya jaata.

## 3. Security (important)

- Files `uploads/lesson-media/<lessonId>/` me rehti hain aur **express.static se
  serve nahi hoti**. `/uploads/lesson-media/...` par seedha request → **404**.
- Playback sirf `/api/lessons/:id/video` aur `/api/lessons/:id/pdf` se hota hai,
  aur wahan **har request par entitlement check** hota hai:
  | Kaun | Result |
  | --- | --- |
  | Guest, non-preview lesson | 401 |
  | Login hai par enrol nahi | 403 |
  | Enrolled learner | 200 |
  | Course owner / admin / assigned developer | 200 |
  | Free **preview** lesson | Public (jaisa pehle tha) |
  | Premium course bina subscription | 403 (`premium` error) |
- `<video>`/`<iframe>` bearer token nahi bhej sakte, isliye lesson page ek
  **short-lived ticket** leta hai (`GET /api/lessons/:id/media`): HMAC over
  (lesson, user, kind, expiry), default **5 minute**. Ticket leak ho jaye to
  bhi sirf wahi lesson, wahi user, 5 minute. Ticket video↔PDF ke beech reuse
  nahi hota.
- Upload par **magic-number check** hota hai, extension par bharosa nahi:
  MP4 ka `ftyp`, WebM ka EBML header, OGV ka `OggS`, PDF ka `%PDF-`. Naam badal
  kar `.mp4` banayi hui PHP file reject ho jaati hai.
- `nosniff` header, `Content-Disposition: inline` (PDF viewer ke liye) aur
  `Cache-Control: private` bheja jaata hai.

## 4. Naye endpoints

| Method | Path | Kaun |
| --- | --- | --- |
| GET | `/api/lessons/:id/media` | entitlement pass hone par — media info + tickets |
| GET | `/api/lessons/:id/video` | gated stream (Range support), `?ticket=` ya Bearer |
| GET | `/api/lessons/:id/pdf` | gated inline PDF, `?download=1` se attachment |
| POST | `/api/lessons/:id/video` | staff + `edit_course` (multipart `video`) |
| POST | `/api/lessons/:id/pdf` | staff + `edit_course` (multipart `pdf`) |
| DELETE | `/api/lessons/:id/video` \| `/pdf` | staff + `edit_course` |

`GET /api/lessons/:id` ka payload ab `video_upload` / `pdf_upload`
(`{ name, mime }`) bhejta hai — **file path kabhi nahi**.

## 5. Database

`npm run migrate` startup par `lessons` table me 4 column add karta hai:
`video_path`, `video_name`, `pdf_path`, `pdf_name` (idempotent).

Manual chahiye to:

```
mysql -u root -p education_platform < database/patch-lesson-media.sql
```

## 6. Naya env (optional)

```
MAX_VIDEO_SIZE_MB=200        # default 200
MAX_PDF_SIZE_MB=25           # default 25
MEDIA_TICKET_TTL_SECONDS=300 # default 300
MEDIA_TOKEN_SECRET=          # optional; JWT_ACCESS_SECRET par fallback
```

## 7. Verification (sandbox, MariaDB 11.8)

- Upload: video 200 OK, PDF 200 OK; extension badalkar bheji gayi fake file →
  rejected with a clear message.
- Stream: `Content-Type: video/mp4`, `Accept-Ranges: bytes`,
  `Range: bytes=0-99` → **206 Partial Content**, `Content-Range: bytes 0-99/2080`.
- PDF: inline `application/pdf`, `?download=1` → `attachment`.
- Guest → 401, unenrolled student → 403 ("Enroll in this course…"),
  enrolled student → 200, PDF ticket video route par → 401,
  garbage ticket → 401, file delete ke baad → 404.
- `/uploads/lesson-media/2/<file>` → **404** (static se serve nahi hota).
- `npm test` me `lessonMedia.test.js` (8 checks: ticket sign/verify/tamper/
  expiry, path escape, mime, name sanitising, signature checks).
