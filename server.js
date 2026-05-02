import express from 'express';
import pg from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';


function inviteRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    phone: row.phone,
    displayName: row.display_name,
    role: row.role,
    team: row.team,
    status: row.status,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    smsText: row.sms_text
  };
}

function userRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    role: row.role,
    team: row.team,
    status: row.status,
    createdAt: row.created_at
  };
}

function aircraftRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    tail: row.tail,
    status: row.status,
    totalFH: Number(row.total_fh || 0),
    sinceInspection: Number(row.since_inspection || 0),
    interval: Number(row.interval_hours || 25),
    inspectionLabel: row.inspection_label,
    lastFlight: row.last_flight,
    updatedAt: row.updated_at
  };
}

function auditRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata || {},
    createdAt: row.created_at
  };
}

async function pgAudit(actor, action, targetType, targetId, metadata = {}) {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor,
    action,
    targetType,
    targetId,
    metadata,
    createdAt: new Date().toISOString()
  };

  if (pool) {
    await dbQuery(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.id, actor, action, targetType, targetId, JSON.stringify(metadata), entry.createdAt]
    );
  } else {
    if (!db.audit) db.audit = [];
    db.audit.unshift(entry);
  }

  return entry;
}

function soNormalizePhone(phone = '') {
  const raw = String(phone).trim().replace(/[\s\-().]/g, '');
  if (raw.startsWith('00')) return '+' + raw.slice(2);
  return raw;
}

function soInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SO-${part()}-${part()}`;
}

function soAudit(actor, action, targetType, targetId, metadata = {}) {
  try {
    if (typeof audit === 'function') {
      return audit(actor, action, targetType, targetId, metadata);
    }
  } catch {}

  if (typeof db !== 'undefined') {
    if (!db.audit) db.audit = [];
    db.audit.unshift({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actor,
      action,
      targetType,
      targetId,
      metadata,
      createdAt: new Date().toISOString()
    });
  }
}


dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

async function dbQuery(sql, params = []) {
  if (!pool) return null;
  return pool.query(sql, params);
}

async function initDb() {
  if (!pool) {
    console.log('DATABASE_URL not set. Using in-memory storage only.');
    return;
  }

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      display_name TEXT,
      role TEXT,
      team TEXT,
      status TEXT,
      max_uses INTEGER DEFAULT 1,
      use_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      used_at TIMESTAMPTZ,
      used_by TEXT,
      sms_text TEXT
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users_app (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      phone TEXT UNIQUE,
      role TEXT,
      team TEXT,
      status TEXT,
      created_at TIMESTAMPTZ
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS aircraft (
      id TEXT PRIMARY KEY,
      type TEXT,
      tail TEXT,
      status TEXT,
      total_fh REAL DEFAULT 0,
      since_inspection REAL DEFAULT 0,
      interval_hours REAL DEFAULT 25,
      inspection_label TEXT,
      last_flight TEXT,
      updated_at TIMESTAMPTZ
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ
    )
  `);

  console.log('PostgreSQL tables ready.');
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-this-admin-token';
const APP_TOKEN = process.env.APP_TOKEN || 'change-this-app-token';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const now = () => new Date().toISOString();
const hhmm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function normalizePhone(phone = '') {
  const raw = String(phone).trim().replace(/[\s\-().]/g, '');
  if (raw.startsWith('00')) return '+' + raw.slice(2);
  return raw;
}

function isExpired(invite) {
  return invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
}

function buildInviteMessage(invite) {
  return `SECUREOPS access code: ${invite.code}. This code is assigned to ${invite.phone} and expires at ${invite.expiresAt || 'manual expiry not set'}.`;
}

const db = {
  users: [
    { id: 'u-admin', displayName: 'SECUREOPS Admin', role: 'admin', status: 'active' },
    { id: 'u-ops', displayName: 'Operations Lead', role: 'operations', status: 'active' },
    { id: 'u-maint', displayName: 'Maintenance Lead', role: 'maintenance', status: 'active' },
    { id: 'u-log', displayName: 'Logistics Lead', role: 'logistics', status: 'active' },
    { id: 'u-crew1', displayName: 'Crew Member 1', role: 'crew', status: 'active' },
    { id: 'u-crew2', displayName: 'Crew Member 2', role: 'crew', status: 'active' }
  ],
  invites: [],
  channels: [
    { id: 'ch-all', name: 'All Personnel', type: 'group', scope: 'all', memberIds: ['u-admin','u-ops','u-maint','u-log','u-crew1','u-crew2'], archived: false },
    { id: 'ch-ops', name: 'Operations', type: 'group', scope: 'operations', memberIds: ['u-admin','u-ops','u-crew1','u-crew2'], archived: false },
    { id: 'ch-maint', name: 'Maintenance', type: 'group', scope: 'maintenance', memberIds: ['u-admin','u-maint','u-crew1'], archived: false },
    { id: 'ch-log', name: 'Logistics', type: 'group', scope: 'logistics', memberIds: ['u-admin','u-log','u-crew2'], archived: false }
  ],
  conversations: [
    { id: 'conv-all', type: 'group', name: 'All Personnel', audience: 'all', participantIds: ['u-admin','u-ops','u-maint','u-log','u-crew1','u-crew2'], channelId: 'ch-all', createdAt: now() },
    { id: 'conv-ops', type: 'group', name: 'Operations', audience: 'group', participantIds: ['u-admin','u-ops','u-crew1','u-crew2'], channelId: 'ch-ops', createdAt: now() },
    { id: 'conv-maint', type: 'group', name: 'Maintenance', audience: 'group', participantIds: ['u-admin','u-maint','u-crew1'], channelId: 'ch-maint', createdAt: now() },
    { id: 'conv-log', type: 'group', name: 'Logistics', audience: 'group', participantIds: ['u-admin','u-log','u-crew2'], channelId: 'ch-log', createdAt: now() },
    { id: 'conv-direct-demo', type: 'direct', name: 'Operations Lead ↔ Crew Member 1', audience: 'direct', participantIds: ['u-ops','u-crew1'], createdAt: now() }
  ],
  messages: [
    { id: nanoid(), conversationId: 'conv-all', audience: 'all', senderId: 'u-admin', senderName: 'SECUREOPS Admin', kind: 'text', body: 'System online. All personnel channel active.', createdAt: now(), time: hhmm() },
    { id: nanoid(), conversationId: 'conv-ops', audience: 'group', senderId: 'u-ops', senderName: 'Operations Lead', kind: 'mission', body: { etd: '14:30', from: 'Doha', to: 'Al Khor', px: '4', note: 'Recon flight along the coast.' }, createdAt: now(), time: hhmm() }
  ],
  aircraft: [
    { id: 'aw189k-qa001', type: 'AW189K', tail: 'QA-001', status: 'Serviceable', totalFH: 842.7, sinceInspection: 38.7, interval: 50, inspectionLabel: '50h Check' },
    { id: 'aw139-qa002', type: 'AW139', tail: 'QA-002', status: 'Limited Serviceable', totalFH: 1260.4, sinceInspection: 94.2, interval: 100, inspectionLabel: '100h Check' },
    { id: 'aw169-qa003', type: 'AW169', tail: 'QA-003', status: 'Serviceable', totalFH: 430.0, sinceInspection: 12.5, interval: 50, inspectionLabel: '50h Check' },
    { id: 's92-qa004', type: 'S-92', tail: 'QA-004', status: 'Serviceable', totalFH: 2180.6, sinceInspection: 71.4, interval: 100, inspectionLabel: '100h Check' }
  ],
  auditLogs: []
};

function audit(actor, action, targetType, targetId, metadata = {}) {
  db.auditLogs.unshift({ id: nanoid(), actor, action, targetType, targetId, metadata, createdAt: now() });
}

function authAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized admin token' });
  next();
}
function authApp(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== APP_TOKEN) return res.status(401).json({ error: 'Unauthorized app token' });
  next();
}
function enrichedAircraft(ac) {
  return { ...ac, remaining: Math.max(Number(ac.interval) - Number(ac.sinceInspection), 0) };
}
function userName(id) { return db.users.find(u => u.id === id)?.displayName || id; }

app.get('/health', (_, res) => res.json({ ok: true, service: 'SECUREOPS backend', version: '0.2.0' }));

app.get('/api/admin/state', authAdmin, (_, res) => res.json({
  users: db.users,
  invites: db.invites,
  channels: db.channels,
  conversations: db.conversations,
  messages: db.messages,
  aircraft: db.aircraft.map(enrichedAircraft),
  auditLogs: db.auditLogs
}));

app.post('/api/admin/invites', authAdmin, (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const code = `SO-${nanoid(4).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  const expiresAt = req.body.expiresAt || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const invite = {
    id: nanoid(),
    code,
    phone,
    displayName: req.body.displayName || 'New SECUREOPS User',
    role: req.body.role || 'crew',
    team: req.body.team || 'Operations',
    status: 'active',
    maxUses: 1,
    useCount: 0,
    createdAt: now(),
    expiresAt,
    sentAt: null,
    usedAt: null,
    usedBy: null,
    smsText: ''
  };

  invite.smsText = buildInviteMessage(invite);

  db.invites.unshift(invite);
  audit('admin', 'invite.created', 'invite', invite.id, {
    phone: invite.phone,
    role: invite.role,
    team: invite.team,
    expiresAt: invite.expiresAt
  });

  res.json(invite);
});
app.post('/api/admin/invites/:id/revoke', authAdmin, (req, res) => { const i = db.invites.find(x => x.id === req.params.id); if (!i) return res.status(404).json({ error: 'Not found' }); i.status='revoked'; audit('admin','invite.revoked','invite',i.id); res.json(i); });

app.post('/api/admin/invites/:id/mark-sent', authAdmin, (req, res) => {
  const i = db.invites.find(x => x.id === req.params.id);
  if (!i) return res.status(404).json({ error: 'Not found' });
  i.sentAt = now();
  audit('admin', 'invite.marked_sent', 'invite', i.id, { phone: i.phone });
  res.json(i);
});

app.post('/api/admin/users', authAdmin, (req, res) => { const u = { id: nanoid(), displayName: req.body.displayName || 'New User', role: req.body.role || 'crew', status: 'active' }; db.users.push(u); audit('admin','user.created','user',u.id); res.json(u); });
app.put('/api/admin/users/:id', authAdmin, (req,res)=> { const u=db.users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({error:'Not found'}); Object.assign(u, req.body); audit('admin','user.updated','user',u.id,req.body); res.json(u); });
app.post('/api/admin/users/:id/deactivate', authAdmin, (req,res)=> { const u=db.users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({error:'Not found'}); u.status='deactivated'; audit('admin','user.deactivated','user',u.id); res.json(u); });

app.post('/api/admin/channels', authAdmin, (req,res)=> { const ch={ id:nanoid(), name:req.body.name||'New Channel', type:'group', scope:req.body.scope||'custom', memberIds:req.body.memberIds||[], archived:false }; db.channels.push(ch); db.conversations.push({ id:`conv-${ch.id}`, type:'group', name:ch.name, audience: ch.scope === 'all' ? 'all' : 'group', participantIds:ch.memberIds, channelId:ch.id, createdAt:now() }); audit('admin','channel.created','channel',ch.id); res.json(ch); });
app.put('/api/admin/channels/:id', authAdmin, (req,res)=> { const ch=db.channels.find(x=>x.id===req.params.id); if(!ch) return res.status(404).json({error:'Not found'}); Object.assign(ch, req.body); const conv=db.conversations.find(c=>c.channelId===ch.id); if(conv){ conv.name=ch.name; conv.participantIds=ch.memberIds; conv.audience=ch.scope==='all'?'all':'group'; } audit('admin','channel.updated','channel',ch.id,req.body); res.json(ch); });

app.post('/api/admin/aircraft', authAdmin, (req,res)=> { const ac={ id:nanoid(), type:req.body.type||'S-92', tail:req.body.tail||'NEW', status:req.body.status||'Serviceable', totalFH:Number(req.body.totalFH||0), sinceInspection:Number(req.body.sinceInspection||0), interval:Number(req.body.interval||50), inspectionLabel:req.body.inspectionLabel||'50h Check' }; db.aircraft.push(ac); audit('admin','aircraft.created','aircraft',ac.id); res.json(enrichedAircraft(ac)); });
app.put('/api/admin/aircraft/:id', authAdmin, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ['type','tail','status','inspectionLabel'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=req.body[k]; }); ['totalFH','sinceInspection','interval'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=Number(req.body[k]); }); audit('admin','aircraft.updated','aircraft',ac.id,req.body); res.json(enrichedAircraft(ac)); });
app.post('/api/admin/aircraft/:id/flight', authAdmin, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); const h=Number(req.body.flightHours||0); ac.totalFH=Number((ac.totalFH+h).toFixed(1)); ac.sinceInspection=Number((ac.sinceInspection+h).toFixed(1)); audit('admin','aircraft.flight_added','aircraft',ac.id,{flightHours:h}); res.json(enrichedAircraft(ac)); });
app.post('/api/admin/aircraft/:id/inspection', authAdmin, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ac.sinceInspection=0; if(req.body.inspectionLabel) ac.inspectionLabel=req.body.inspectionLabel; audit('admin','aircraft.inspection_reset','aircraft',ac.id); res.json(enrichedAircraft(ac)); });

// App APIs
app.post('/api/app/invites/validate', authApp, (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim().toUpperCase();

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone number and invite code are required' });
  }

  const invite = db.invites.find(i => i.code === code);

  if (!invite) {
    audit('app', 'invite.validation_failed', 'invite', 'unknown', { reason: 'code_not_found', phone });
    return res.status(401).json({ error: 'Invalid invite code' });
  }

  if (normalizePhone(invite.phone) !== phone) {
    audit('app', 'invite.validation_failed', 'invite', invite.id, { reason: 'phone_mismatch', expected: invite.phone, received: phone });
    return res.status(401).json({ error: 'Phone number does not match this invite' });
  }

  if (invite.status !== 'active') {
    audit('app', 'invite.validation_failed', 'invite', invite.id, { reason: 'not_active', status: invite.status });
    return res.status(401).json({ error: `Invite is ${invite.status}` });
  }

  if (isExpired(invite)) {
    invite.status = 'expired';
    audit('app', 'invite.validation_failed', 'invite', invite.id, { reason: 'expired' });
    return res.status(401).json({ error: 'Invite expired' });
  }

  if (invite.useCount >= invite.maxUses) {
    invite.status = 'used';
    audit('app', 'invite.validation_failed', 'invite', invite.id, { reason: 'already_used' });
    return res.status(401).json({ error: 'Invite already used' });
  }

  let user = db.users.find(u => normalizePhone(u.phone) === phone);

  if (!user) {
    user = {
      id: `u-${nanoid(8)}`,
      displayName: invite.displayName,
      phone,
      role: invite.role,
      team: invite.team,
      status: 'active',
      createdAt: now()
    };
    db.users.push(user);
  } else {
    user.status = 'active';
    user.role = invite.role || user.role;
    user.team = invite.team || user.team;
  }

  invite.useCount += 1;
  invite.status = 'used';
  invite.usedAt = now();
  invite.usedBy = user.id;

  // Add user to All Personnel and team channel
  for (const ch of db.channels) {
    const shouldJoin =
      ch.scope === 'all' ||
      String(ch.scope).toLowerCase() === String(invite.team).toLowerCase();

    if (shouldJoin && !ch.memberIds.includes(user.id)) ch.memberIds.push(user.id);
  }

  for (const conv of db.conversations) {
    const shouldJoin =
      conv.audience === 'all' ||
      String(conv.name).toLowerCase() === String(invite.team).toLowerCase();

    if (shouldJoin && !conv.participantIds.includes(user.id)) conv.participantIds.push(user.id);
  }

  audit('app', 'invite.validated', 'invite', invite.id, {
    phone,
    userId: user.id,
    role: user.role,
    team: user.team
  });

  res.json({
    ok: true,
    user,
    invite: {
      id: invite.id,
      status: invite.status,
      usedAt: invite.usedAt
    },
    appTokenHint: 'Use configured APP_TOKEN for API calls'
  });
});

app.get('/api/app/users', authApp, (_,res)=> res.json(db.users.filter(u=>u.status==='active')));
app.get('/api/app/conversations', authApp, (req,res)=> { const userId=req.query.userId || 'u-ops'; res.json(db.conversations.filter(c=>c.audience==='all' || c.participantIds.includes(userId))); });
app.post('/api/app/conversations/direct', authApp, (req,res)=> { const { fromUserId='u-ops', toUserId }=req.body; if(!toUserId) return res.status(400).json({error:'toUserId required'}); let conv=db.conversations.find(c=>c.type==='direct' && c.participantIds.includes(fromUserId) && c.participantIds.includes(toUserId)); if(!conv){ conv={ id:nanoid(), type:'direct', name:`${userName(fromUserId)} ↔ ${userName(toUserId)}`, audience:'direct', participantIds:[fromUserId,toUserId], createdAt:now()}; db.conversations.push(conv); audit(fromUserId,'conversation.direct_created','conversation',conv.id,{toUserId}); } res.json(conv); });
app.get('/api/app/conversations/:id/messages', authApp, (req,res)=> res.json(db.messages.filter(m=>m.conversationId===req.params.id)));
app.post('/api/app/messages', authApp, (req,res)=> { const conv=db.conversations.find(c=>c.id===req.body.conversationId); if(!conv) return res.status(404).json({error:'Conversation not found'}); const senderId=req.body.senderId||'u-ops'; const msg={ id:nanoid(), conversationId:conv.id, audience:conv.audience, senderId, senderName:userName(senderId), kind:req.body.kind||'text', body:req.body.body||'', createdAt:now(), time:hhmm() }; db.messages.push(msg); audit(senderId,'message.sent','conversation',conv.id,{audience:conv.audience, kind:msg.kind}); res.json(msg); });
app.get('/api/app/aircraft', authApp, (_,res)=> res.json(db.aircraft.map(enrichedAircraft)));
app.put('/api/app/aircraft/:id', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ['type','tail','status','inspectionLabel'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=req.body[k]; }); ['totalFH','sinceInspection','interval'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=Number(req.body[k]); }); audit('app','aircraft.updated','aircraft',ac.id,req.body); res.json(enrichedAircraft(ac)); });
app.post('/api/app/aircraft/:id/flight', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); const h=Number(req.body.flightHours||0); ac.totalFH=Number((ac.totalFH+h).toFixed(1)); ac.sinceInspection=Number((ac.sinceInspection+h).toFixed(1)); audit('app','aircraft.flight_added','aircraft',ac.id,{flightHours:h}); res.json(enrichedAircraft(ac)); });
app.post('/api/app/aircraft/:id/inspection', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ac.sinceInspection=0; if(req.body.inspectionLabel) ac.inspectionLabel=req.body.inspectionLabel; audit('app','aircraft.inspection_reset','aircraft',ac.id); res.json(enrichedAircraft(ac)); });


// SECUREOPS phone-bound invite routes
app.get('/api/admin/phone-invites', authAdmin, (req, res) => {
  res.json(db.invites || []);
});

app.post('/api/admin/phone-invites', authAdmin, (req, res) => {
  if (!db.invites) db.invites = [];
  if (!db.users) db.users = [];

  const phone = soNormalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const expiryHours = Number(req.body.expiryHours || 72);
  if (!Number.isFinite(expiryHours) || expiryHours <= 0) {
    return res.status(400).json({ error: 'Expiry hours must be a positive number' });
  }

  const code = soInviteCode();
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const invite = {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    phone,
    displayName: req.body.displayName || 'New SECUREOPS User',
    role: req.body.role || 'crew',
    team: req.body.team || 'Operations',
    status: 'active',
    maxUses: 1,
    useCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt,
    expiryHours,
    sentAt: null,
    usedAt: null,
    usedBy: null
  };

  invite.smsText = `SECUREOPS access code: ${invite.code}. Assigned to ${invite.phone}. Valid for ${expiryHours} hours.`;

  db.invites.unshift(invite);

  soAudit('admin', 'invite.created', 'invite', invite.id, {
    phone: invite.phone,
    role: invite.role,
    team: invite.team,
    expiresAt: invite.expiresAt
  });

  res.json(invite);
});

app.post('/api/admin/phone-invites/:id/mark-sent', authAdmin, (req, res) => {
  const invite = (db.invites || []).find(i => i.id === req.params.id);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });

  invite.sentAt = new Date().toISOString();

  soAudit('admin', 'invite.marked_sent', 'invite', invite.id, {
    phone: invite.phone
  });

  res.json(invite);
});

app.post('/api/admin/phone-invites/:id/revoke', authAdmin, (req, res) => {
  const invite = (db.invites || []).find(i => i.id === req.params.id);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });

  invite.status = 'revoked';
  invite.revokedAt = new Date().toISOString();

  soAudit('admin', 'invite.revoked', 'invite', invite.id, {
    phone: invite.phone
  });

  res.json(invite);
});

app.post('/api/app/phone-invites/validate', authApp, (req, res) => {
  if (!db.invites) db.invites = [];
  if (!db.users) db.users = [];

  const phone = soNormalizePhone(req.body.phone);
  const code = String(req.body.code || '').trim().toUpperCase();

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone number and access code are required' });
  }

  const invite = db.invites.find(i => String(i.code).toUpperCase() === code);

  if (!invite) {
    soAudit('app', 'invite.validation_failed', 'invite', 'unknown', {
      reason: 'code_not_found',
      phone
    });
    return res.status(401).json({ error: 'Invalid invite code' });
  }

  if (soNormalizePhone(invite.phone) !== phone) {
    soAudit('app', 'invite.validation_failed', 'invite', invite.id, {
      reason: 'phone_mismatch',
      expected: invite.phone,
      received: phone
    });
    return res.status(401).json({ error: 'Phone number does not match this invite' });
  }

  if (invite.status !== 'active') {
    return res.status(401).json({ error: `Invite is ${invite.status}` });
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'expired';
    return res.status(401).json({ error: 'Invite expired' });
  }

  if ((invite.useCount || 0) >= (invite.maxUses || 1)) {
    invite.status = 'used';
    return res.status(401).json({ error: 'Invite already used' });
  }

  let user = db.users.find(u => soNormalizePhone(u.phone) === phone);

  if (!user) {
    user = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayName: invite.displayName,
      phone,
      role: invite.role,
      team: invite.team,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
  } else {
    user.status = 'active';
    user.role = invite.role || user.role;
    user.team = invite.team || user.team;
  }

  invite.useCount = (invite.useCount || 0) + 1;
  invite.status = 'used';
  invite.usedAt = new Date().toISOString();
  invite.usedBy = user.id;

  soAudit('app', 'invite.validated', 'invite', invite.id, {
    phone,
    userId: user.id,
    role: user.role,
    team: user.team
  });

  res.json({
    ok: true,
    user,
    invite: {
      id: invite.id,
      status: invite.status,
      usedAt: invite.usedAt
    }
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`SECUREOPS backend/admin running on http://localhost:${PORT}`));