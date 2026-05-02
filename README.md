# SECUREOPS Backend + Admin Console

Local MVP backend/admin console for SECUREOPS.

## Run

```bash
cp .env.example .env
npm install
npm start
```

Open:

```text
http://localhost:8080
```

Admin token:

```text
change-this-admin-token
```

Health check:

```text
http://localhost:8080/health
```

## Messaging model

SECUREOPS supports three message audiences:

- `direct` - one-to-one user conversation
- `group` - channel/team conversation such as Operations, Maintenance, Logistics
- `all` - all-personnel broadcast conversation

Every message includes an `audience` field so the app can clearly display whether the message is DIRECT, GROUP, or ALL.

## App endpoints

Use header:

```text
Authorization: Bearer change-this-app-token
```

- `GET /api/app/users`
- `GET /api/app/conversations?userId=u-ops`
- `POST /api/app/conversations/direct`
- `GET /api/app/conversations/:id/messages`
- `POST /api/app/messages`
- `GET /api/app/aircraft`
- `PUT /api/app/aircraft/:id`
- `POST /api/app/aircraft/:id/flight`
- `POST /api/app/aircraft/:id/inspection`

This is an MVP. It is not production-grade E2EE yet.
