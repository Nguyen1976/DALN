# DALN Chat: frontend

The React single-page app for DALN Chat. For the architecture, features and how the backend fits in, see the [root README](../README.md).

**Stack:** React 19, TypeScript, Vite 7, Redux Toolkit + redux-persist, React Router 7, Tailwind CSS 4, Radix UI, React Hook Form + Zod, Socket.IO client, WebRTC.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | type-check (`tsc -b`) and production build into `dist/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | type-check only |
| `npm run preview` | serve the production build locally |

## Configuration

Two variables, both baked into the bundle at build time:

| Variable | Dev default (`.env.development`) | Meaning |
|---|---|---|
| `VITE_API_ROOT` | `http://localhost:8080` | Kong gateway, the only API entry point |
| `VITE_SOCKET_URL` | `http://localhost:8080/realtime` | Socket.IO namespace, also routed through Kong |

For production, [`Dockerfile`](Dockerfile) takes them as build args and serves the build with nginx ([`nginx.conf`](nginx.conf): SPA fallback, long-lived caching for hashed assets, `index.html` never cached).

## Layout

```
src/
├── apis/         API calls over one axios instance that sends the session cookies
├── components/   shared UI
├── hooks/        chat, socket events, typing, WebRTC calls, ringtones
├── layouts/      app shells
├── lib/          Socket.IO client and its auth-recovery logic
├── pages/        Auth, VerifyOtp, InterestOnboarding, Chat, Friend, Recommendation, NotificationSettings
├── redux/        slices + redux-persist
└── utils/        helpers, constants, media limits
```
