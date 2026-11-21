# මං 5හේ (Man 5he) — Full System Architecture, Security & Operations Manual

## 1. Platform Overview
**මං 5හේ (Man 5he)** is a paid, multi-layer secured online learning, psychometric assessment, and timed examination platform engineered specifically for Sri Lankan **Grade 5 Scholarship (ශිෂ්‍යත්වය)** students and their parents.

### Core Capabilities
- **500,000+ Shuffled Quiz Practice Engine**: Combines curated bilingual (Sinhala + English) questions with a deterministic, seeded Fisher-Yates parametric generator covering `500,000+` unique scholarship questions across 6 intelligence domains.
- **Child Psychological Memory Instructions**: Every practice question includes a child-friendly mnemonic story, visual cue, or rhythm trick (`මතක තබා ගැනීමේ මනෝවිද්‍යාත්මක උපක්‍රමය`).
- **Strict Study vs. Timed Exam Separation**:
  - *Practice Mode*: Unlocks psychological memory tricks, step-by-step explanations, and gamified star rewards.
  - *Timed Exam Mode*: Server strips `correctIndex`, `memoryTrickBody`, and `explanation` from API payloads and enforces a server-backed countdown timer.
- **Admin Psychometric & Paper Quality Studio**: Admins draw diagrams on an HTML5 Canvas sketchpad or upload images, assign psychometric attributes (`intelligenceMeasure`, `correctProbability`/`wrongProbability`, `examPriority`, `quizStrength`), and assemble papers whose **Quality Index** and **Difficulty Tier** (`Foundation Simple` → `Scholarship Master`) are automatically computed.
- **Automated Parent Communications**: Dispatches branded `මං 5හේ` HTML emails (Registration OTP, Login OTP, Payment Creation OTP, HMAC-verified LKR Invoices, Exam Progress Reports) and formatted WhatsApp alerts.

---

## 2. System Architecture Diagram

```
+-----------------------------------------------------------------------------+
|                        Client SPA (React 19 + Vite + Tailwind)              |
|  - Auth & Payment Gate (CAPTCHA, Robot Guard, Email OTP, Google TOTP)       |
|  - Student Portal (Welcome Hero, 4 Color Modules, Parent Tracker, Gauge)    |
|  - Practice Arena (500K+ Shuffled Engine + Psychological Memory Tricks)     |
|  - Timed Exam Hall (Countdown Timer + Locked Hints + Post-Exam Review)      |
|  - Admin Studio (Canvas Pad, Image Upload, Psychometrics, Paper Builder)    |
+--------------------------------------+--------------------------------------+
                                       | HTTPS / Bearer HMAC Session Token
                                       v
+-----------------------------------------------------------------------------+
|                     Express API & Security Gateway (server.ts)              |
|  - Auth Middleware & Role Guard (student | admin)                           |
|  - CAPTCHA + Honeypot + Behavioral Verification (src/lib/security.ts)       |
|  - RFC 6238 Google Authenticator TOTP Engine                                |
|  - Email OTP Challenge Store (Registration, Login, Payment Creation)        |
|  - Signed Payment Checkout & Webhook HMAC-SHA256 Verifier                   |
|  - Psychometrics & Paper Quality Calculator (src/lib/psychometrics.ts)      |
|  - Branded HTML Email & WhatsApp Formatter (src/lib/notifications.ts)       |
+--------------------------------------+--------------------------------------+
                                       | Atomic Persistence
                                       v
+-----------------------------------------------------------------------------+
|                   Persistent Store (data/db.json / PostgreSQL)              |
|  - users (Scrypt hashes, TOTP Base32 secrets, subscription status, level)   |
|  - curatedQuizzes (Admin drawings/images, memory tricks, psychometrics)     |
|  - papers (Quiz IDs, computed PaperQualitySummary, duration)                |
|  - attempts (Scores, domain breakdown, time spent, stars)                   |
|  - invoices, emailLogs, whatsappLogs, activeExamSessions                    |
+-----------------------------------------------------------------------------+
```

---

## 3. Psychometric & Paper Quality Formulas

### 3.1 Individual Quiz Difficulty Score
Each quiz $q$ carries psychometric attributes:
- $I_q \in [1, 100]$: Intelligence Measure (`intelligenceMeasure`)
- $P_{\text{wrong}} \in [0.05, 0.95]$: Historical / expected wrong-answer probability (`1 - correctProbability`)
- $S_q \in [1, 100]$: Psychometric discrimination strength (`quizStrength`)
- $E_q \in [1, 10]$: Scholarship Exam Priority (`examPriority`)

$$\text{DifficultyScore}(q) = 0.42(100 \cdot P_{\text{wrong}}) + 0.30 I_q + 0.18 S_q + 0.10(10 \cdot E_q)$$

Classification tiers:
- `< 35`: **Simple**
- `35 – 57.9`: **Moderate**
- `58 – 75.9`: **Challenging**
- `>= 76`: **Master**

### 3.2 Paper Quality Index & Categorization
When an Admin selects $n$ quizzes for a paper, `calculatePaperQualityAndDifficulty(quizzes)` computes:
- Average Strength $\bar{S}$, Average Priority $\bar{E}$, Cognitive Domain Coverage $D_{\text{cov}} = \frac{|\text{Domains}|}{6} \times 100$, and Difficulty Standard Deviation Balance $B = \text{clamp}(100 - |\sigma - 14| \times 2.5, 40, 100)$.

$$\text{QualityIndex} = 0.30\bar{S} + 0.25(10\bar{E}) + 0.20 D_{\text{cov}} + 0.15 B + 0.10 \min\left(100, \frac{n}{15}\cdot 100\right)$$

Paper Difficulty Level:
- `avgDifficulty >= 73`: **Scholarship Master**
- `avgDifficulty >= 55`: **Advanced Challenging**
- `avgDifficulty >= 36`: **Balanced Standard**
- `< 36`: **Foundation Simple**

### 3.3 Student Trajectory & Level Advancement
`evaluateStudentTrajectory(attempts, currentLevel)` inspects the student's recent 5 attempts vs. prior 5 attempts:
- Computes **Scholarship Readiness %** (for the Parent Tracker speedometer gauge).
- Surfaces top **Weak Cognitive Domains** ("Areas to Improve").
- Automatically recommends advancing to the next paper tier when recent average $\ge 80\%$, or consolidating foundations when $< 48\%$.

---

## 4. Multi-Layer Security Architecture

| Security Layer | Mechanism | Enforcement Scope |
| :--- | :--- | :--- |
| **Password Storage** | `crypto.scryptSync` with 16-byte random salt + `timingSafeEqual` | Registration & Login |
| **Robot Guard** | Hidden honeypot field + explicit human verification state | Registration & Login |
| **SVG CAPTCHA** | Server-rendered SVG arithmetic challenge signed via HMAC-SHA256 | Registration & Login |
| **Email OTP** | 6-digit CSPRNG (`crypto.randomInt`) 10-min expiring challenge | Registration, Login Step 2, Payment Creation |
| **Google Authenticator** | RFC 6238 TOTP (SHA-1, 6 digits, 30s period, $\pm 1$ window) + QR setup | Registration, Login Step 2, Payment Creation |
| **Session Tokens** | HMAC-SHA256 signed payload with expiration | All authenticated API routes |
| **Payment Gateway** | HMAC-SHA256 signed checkout order + webhook signature verification | PayHere LKR & Stripe Card confirmation |
| **Exam Integrity** | Server strips `correctIndex`, `memoryTrickBody`, and `explanation` | `GET /api/papers/:id/start` |

---

## 5. Environment Variables Reference (`.env.example`)

| Variable | Purpose |
| :--- | :--- |
| `PORT` | Express + Vite server port (default `3000`) |
| `APP_URL` | Public deployment URL for callbacks and email links |
| `GEMINI_API_KEY` | Optional server-side Gemini API key |
| `AUTH_SESSION_SECRET` | 256-bit HMAC secret signing user session tokens |
| `CAPTCHA_SIGNING_SECRET` | 256-bit HMAC secret signing SVG CAPTCHA challenges |
| `TOTP_ISSUER_NAME` | Label shown inside Google Authenticator (`Man5he Scholarship`) |
| `EMAIL_OTP_TTL_SECONDS` | Expiration window for Email OTP codes (default `600`) |
| `DATA_STORE_PATH` | Path to persistent store (`./data/db.json`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Outbound SMTP credentials for HTML email dispatch |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Cloud API credentials for parent alerts |
| `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET` | PayHere Sri Lanka LKR gateway credentials |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe card gateway credentials |
