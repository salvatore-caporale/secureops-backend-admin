import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-this-admin-token';
const APP_TOKEN = process.env.APP_TOKEN || 'change-this-app-token';

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const now = () => new Date().toISOString();
const hhmm = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
  const code = `SO-${nanoid(4).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  const invite = { id: nanoid(), code, role: req.body.role || 'crew', status: 'active', createdAt: now(), expiresAt: req.body.expiresAt || null };
  db.invites.unshift(invite); audit('admin', 'invite.created', 'invite', invite.id, { role: invite.role }); res.json(invite);
});
app.post('/api/admin/invites/:id/revoke', authAdmin, (req, res) => { const i = db.invites.find(x => x.id === req.params.id); if (!i) return res.status(404).json({ error: 'Not found' }); i.status='revoked'; audit('admin','invite.revoked','invite',i.id); res.json(i); });

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
app.get('/api/app/users', authApp, (_,res)=> res.json(db.users.filter(u=>u.status==='active')));
app.get('/api/app/conversations', authApp, (req,res)=> { const userId=req.query.userId || 'u-ops'; res.json(db.conversations.filter(c=>c.audience==='all' || c.participantIds.includes(userId))); });
app.post('/api/app/conversations/direct', authApp, (req,res)=> { const { fromUserId='u-ops', toUserId }=req.body; if(!toUserId) return res.status(400).json({error:'toUserId required'}); let conv=db.conversations.find(c=>c.type==='direct' && c.participantIds.includes(fromUserId) && c.participantIds.includes(toUserId)); if(!conv){ conv={ id:nanoid(), type:'direct', name:`${userName(fromUserId)} ↔ ${userName(toUserId)}`, audience:'direct', participantIds:[fromUserId,toUserId], createdAt:now()}; db.conversations.push(conv); audit(fromUserId,'conversation.direct_created','conversation',conv.id,{toUserId}); } res.json(conv); });
app.get('/api/app/conversations/:id/messages', authApp, (req,res)=> res.json(db.messages.filter(m=>m.conversationId===req.params.id)));
app.post('/api/app/messages', authApp, (req,res)=> { const conv=db.conversations.find(c=>c.id===req.body.conversationId); if(!conv) return res.status(404).json({error:'Conversation not found'}); const senderId=req.body.senderId||'u-ops'; const msg={ id:nanoid(), conversationId:conv.id, audience:conv.audience, senderId, senderName:userName(senderId), kind:req.body.kind||'text', body:req.body.body||'', createdAt:now(), time:hhmm() }; db.messages.push(msg); audit(senderId,'message.sent','conversation',conv.id,{audience:conv.audience, kind:msg.kind}); res.json(msg); });
app.get('/api/app/aircraft', authApp, (_,res)=> res.json(db.aircraft.map(enrichedAircraft)));
app.put('/api/app/aircraft/:id', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ['type','tail','status','inspectionLabel'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=req.body[k]; }); ['totalFH','sinceInspection','interval'].forEach(k=>{ if(req.body[k]!==undefined) ac[k]=Number(req.body[k]); }); audit('app','aircraft.updated','aircraft',ac.id,req.body); res.json(enrichedAircraft(ac)); });
app.post('/api/app/aircraft/:id/flight', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); const h=Number(req.body.flightHours||0); ac.totalFH=Number((ac.totalFH+h).toFixed(1)); ac.sinceInspection=Number((ac.sinceInspection+h).toFixed(1)); audit('app','aircraft.flight_added','aircraft',ac.id,{flightHours:h}); res.json(enrichedAircraft(ac)); });
app.post('/api/app/aircraft/:id/inspection', authApp, (req,res)=> { const ac=db.aircraft.find(x=>x.id===req.params.id); if(!ac) return res.status(404).json({error:'Not found'}); ac.sinceInspection=0; if(req.body.inspectionLabel) ac.inspectionLabel=req.body.inspectionLabel; audit('app','aircraft.inspection_reset','aircraft',ac.id); res.json(enrichedAircraft(ac)); });

app.listen(PORT, () => console.log(`SECUREOPS backend/admin running on http://localhost:${PORT}`));
