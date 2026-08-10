<p align="center">
  <a href="https://nestjs.com/" target="_blank"><img src="https://nestjs.com/img/logo-small.svg" width="80" alt="Nest Logo" /></a>
  &nbsp;&nbsp;
  <a href="https://react.dev/" target="_blank"><img src="https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg" width="80" alt="React Logo" /></a>
</p>

<p align="center">
  <strong>DALN — Real-time Chat Platform</strong>
</p>

<p align="center">
  Event-driven microservices chat application built with NestJS and React.
</p>

<p align="center">
  <a href="https://nguyen1976.xyz" target="_blank"><img src="https://img.shields.io/badge/demo-live-22c55e?style=flat-square" alt="Live Demo" /></a>
  <a href="https://github.com/Nguyen1976/DALN" target="_blank"><img src="https://img.shields.io/github/stars/Nguyen1976/DALN?style=flat-square" alt="GitHub Stars" /></a>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
</p>

---

## Description

**DALN** is a full-stack real-time messaging platform with a microservices backend. It supports 1:1 and group chat, online presence, friend requests, and AI-powered friend recommendations — designed for scalability with async messaging, caching, and distributed transaction patterns.

**Live demo**

| | URL |
|---|---|
| Frontend | [https://nguyen1976.xyz](https://nguyen1976.xyz) |
| API (Kong) | [https://api.nguyen1976.xyz](https://api.nguyen1976.xyz) |

## Highlights

- **Microservices architecture** — 6 NestJS services behind Kong API Gateway
- **Real-time messaging** — Socket.IO gateway with Redis-backed presence tracking
- **Event-driven writes** — RabbitMQ + Redis batching to reduce database pressure
- **Distributed consistency** — Saga Orchestration + Transactional Outbox pattern
- **Friend recommendation** — Top-K suggestions via social graph, bio similarity (Qdrant), and location signals
- **CI/CD on AWS** — GitHub Actions, Docker, ECR, EC2, S3, CloudFront

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────────────────────┐
│  React SPA  │────▶│  Kong :8000  │────▶│  user · chat · notification · …     │
│  (Vite)     │     │  API Gateway │     │  NestJS microservices               │
└──────┬──────┘     └──────────────┘     └──────────┬──────────────────────────┘
       │                                              │
       │ WebSocket                                    │ RabbitMQ / BullMQ
       ▼                                              ▼
┌─────────────┐                            ┌──────────────────┐
│  Realtime   │◀──────────────────────────▶│  MongoDB · Redis │
│  Gateway    │                            │  Qdrant          │
└─────────────┘                            └──────────────────┘
```

### Services

| Service | Responsibility |
|---------|----------------|
| `user` | Auth, profiles, friendships |
| `chat` | Conversations, messages, read receipts |
| `notification` | Email & in-app notifications |
| `realtime-gateway` | WebSocket events, presence |
| `recommendation` | Friend suggestions (Qdrant + graph) |
| `saga-orchestrator` | Cross-service workflows (e.g. accept friend) |

## Tech Stack

**Backend** — NestJS, TypeScript, Prisma, MongoDB, Redis, RabbitMQ, BullMQ, Socket.IO, Kong, Qdrant

**Frontend** — React, TypeScript, Vite, Redux Toolkit, TailwindCSS, Radix UI

**DevOps** — Docker, GitHub Actions, AWS (EC2, ECR, S3, CloudFront, Route 53)

## Project Structure

```
DALN/
├── backend/          # NestJS monorepo (microservices)
│   ├── apps/       # user, chat, notification, realtime-gateway, …
│   ├── libs/       # shared modules
│   ├── kong/       # API gateway config
│   └── docker-compose.yml
├── frontend/       # React SPA (Vite)
├── testing/        # k6 / Playwright load & E2E tests
└── training/       # offline ML pipeline for recommendations
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### Backend (local)

```bash
cd backend
# Cần file .env và .env.docker (xem docker-compose.yml)
docker compose up -d
```

Services will be available through Kong at `http://localhost:8080`.

### Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### Production deploy

Pushing to `main` triggers GitHub Actions:

- **Backend** — build Docker images → push to ECR → deploy to EC2 via SSM
- **Frontend** — build static assets → sync to S3 → invalidate CloudFront

Manual deploy: **Actions → Deploy Backend / Deploy Frontend → Run workflow**.

## Author

**Nguyen Ha Nguyen** — Backend Developer

- GitHub: [@Nguyen1976](https://github.com/Nguyen1976)
- Email: nguyenhanguyen25.work@gmail.com

## License

This project is for educational and portfolio purposes.
