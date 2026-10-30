import {bindCommand} from './val/commands.mjs';
import {postTransfer as transfer} from './val/ledger.mjs';
import {policy,checkStake,tenantFor} from './stake-policy.mjs';
/** WAE v0.9: transactional two-player rooms. Only Dice Duel (T0) is multiplayer.
 * No VCUR reads/writes, no user-to-user transfers outside game settlement.
 */
import {randomInt} from 'node:crypto';
import {uuid,now,json,parse,assert,fail} from './util.mjs';
import {transaction,accountId,wallet} from './db.mjs';

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_AGE=2*60*60*1000;
function inviteCode(){let s='';for(let i=0;i<7;i++)s+=ALPHABET[randomInt(ALPHABET.length)];return s;}
export function setupRooms(db){db.exec(`
 CREATE TABLE IF NOT EXISTS multiplayer_rooms(
  id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,code TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL REFERENCES players(id),game_code TEXT NOT NULL,
  bet INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('OPEN','FINISHED','CANCELLED')),
  version INTEGER NOT NULL,result_json TEXT,created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS multiplayer_members(
  room_id TEXT NOT NULL REFERENCES multiplayer_rooms(id),player_id TEXT NOT NULL REFERENCES players(id),
  seat INTEGER NOT NULL CHECK(seat BETWEEN 1 AND 2),ready INTEGER NOT NULL DEFAULT 0,
  joined_ms INTEGER NOT NULL,PRIMARY KEY(room_id,player_id),UNIQUE(room_id,seat)
 );
 CREATE TABLE IF NOT EXISTS multiplayer_commands(
  tenant_id TEXT NOT NULL,player_id TEXT NOT NULL,command_id TEXT NOT NULL,
  room_id TEXT NOT NULL,response_json TEXT NOT NULL,
  PRIMARY KEY(tenant_id,player_id,command_id)
 );
 CREATE INDEX IF NOT EXISTS mp_room_lookup ON multiplayer_rooms(tenant_id,status,created_ms);
 CREATE INDEX IF NOT EXISTS mp_members_user ON multiplayer_members(player_id,room_id);
 `);}
const roomRecord=(db,idOrCode,tenant='wa-world')=>db.prepare('SELECT * FROM multiplayer_rooms WHERE tenant_id=? AND (id=? OR code=?)').get(tenant,idOrCode,idOrCode);
const members=(db,id)=>db.prepare('SELECT * FROM multiplayer_members WHERE room_id=? ORDER BY seat').all(id);
function view(db,room,playerId){
 const all=members(db,room.id),mySeat=all.find(m=>m.player_id===playerId)?.seat??null;
 return {id:room.id,code:room.code,game_code:room.game_code,bet:room.bet,
  status:room.status==='OPEN'&&room.expires_ms<=now()?'EXPIRED':room.status,
  version:room.version,capacity:2,player_count:all.length,is_member:mySeat!==null,
  is_host:room.host_id===playerId,my_seat:mySeat,
  members:all.map(m=>({seat:m.seat,ready:Boolean(m.ready),is_me:m.player_id===playerId})),
  result:room.result_json?parse(room.result_json):null,expires_ms:room.expires_ms,
  created_ms:room.created_ms};
}
function findRoom(db,id,playerId,memberOnly=true){const room=roomRecord(db,id);assert(room,404,'ROOM_NOT_FOUND');if(memberOnly)assert(members(db,room.id).some(m=>m.player_id===playerId),403,'ROOM_ACCESS_DENIED');return room;}
function commandId(commandId){assert(typeof commandId==='string'&&/^[a-zA-Z0-9:_-]{12,100}$/.test(commandId),400,'INVALID_COMMAND_ID');}
function checkVersion(room,version){assert(Number.isSafeInteger(version),400,'VERSION_REQUIRED');assert(room.version===version,409,'ROOM_STATE_STALE');}
function openRoom(room){assert(room.status==='OPEN',409,'ROOM_CLOSED');assert(room.expires_ms>now(),409,'ROOM_EXPIRED');}
function processOnce(db,playerId,cmd,roomId,callback){
 commandId(cmd);
 const prev=db.prepare('SELECT room_id,response_json FROM multiplayer_commands WHERE tenant_id=? AND player_id=? AND command_id=?').get('wa-world',playerId,cmd);
 if(prev){assert(prev.room_id===roomId,409,'COMMAND_REUSED_FOR_OTHER_ROOM');return parse(prev.response_json);}
 const result=callback();
 db.prepare('INSERT INTO multiplayer_commands VALUES(?,?,?,?,?)').run('wa-world',playerId,cmd,roomId,json(result));
 return result;
}
function stamp(db,room,extra={}){
 const version=room.version+1;
 db.prepare('UPDATE multiplayer_rooms SET version=?,updated_ms=?,status=COALESCE(?,status),result_json=COALESCE(?,result_json) WHERE id=? AND version=?')
 .run(version,now(),extra.status??null,extra.result?json(extra.result):null,room.id,room.version);
 return db.prepare('SELECT * FROM multiplayer_rooms WHERE id=?').get(room.id);
}
export function createRoom(db,playerId,{bet=10,command_id}={}){
 commandId(command_id);tenantFor(db,playerId);checkStake(bet,policy(db,'T0'));
 return transaction(db,()=>{
  bindCommand(db,playerId,command_id,{operation:'room.create',bet});
  const prior=db.prepare('SELECT room_id,response_json FROM multiplayer_commands WHERE tenant_id=? AND player_id=? AND command_id=?').get('wa-world',playerId,command_id);
  if(prior)return parse(prior.response_json);
  // Limit unattended rooms per player, avoiding unbounded spam even before API rate limits.
  const open=db.prepare("SELECT COUNT(*) n FROM multiplayer_rooms WHERE host_id=? AND status='OPEN' AND expires_ms>?").get(playerId,now()).n;
  assert(open<3,429,'ROOM_LIMIT');
  const id=uuid(),created=now();let code;
  for(let tries=0;tries<10;tries++){code=inviteCode();if(!roomRecord(db,code))break;code=null;}
  assert(code,500,'ROOM_CODE_EXHAUSTED');
  db.prepare('INSERT INTO multiplayer_rooms VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'wa-world',code,playerId,'T0',bet,'OPEN',1,null,created,created,created+MAX_AGE);
  db.prepare('INSERT INTO multiplayer_members VALUES(?,?,?,?,?)').run(id,playerId,1,0,created);
  const result={room:view(db,roomRecord(db,id),playerId),balance:wallet(db,playerId)};
  db.prepare('INSERT INTO multiplayer_commands VALUES(?,?,?,?,?)').run('wa-world',playerId,command_id,id,json(result));
  return result;
 });
}
export function roomPreview(db,playerId,code){const r=roomRecord(db,String(code).toUpperCase());assert(r,404,'ROOM_NOT_FOUND');openRoom(r);return {room:view(db,r,playerId)};}
export function roomInfo(db,playerId,id){return {room:view(db,findRoom(db,id,playerId),playerId),balance:wallet(db,playerId)};}
export function myRooms(db,playerId){
 const rows=db.prepare(`SELECT r.* FROM multiplayer_rooms r JOIN multiplayer_members m ON m.room_id=r.id WHERE m.player_id=? ORDER BY r.updated_ms DESC LIMIT 30`).all(playerId);
 return rows.map(r=>view(db,r,playerId));
}
export function publicRooms(db,playerId){
 const rows=db.prepare(`SELECT * FROM multiplayer_rooms r WHERE tenant_id='wa-world' AND status='OPEN' AND expires_ms>? ORDER BY created_ms DESC LIMIT 25`).all(now());
 return rows.map(r=>view(db,r,playerId));
}
export function joinRoom(db,playerId,code,{expected_version,command_id}={}){
 return transaction(db,()=>{
  bindCommand(db,playerId,command_id,{operation:'room.join',code:String(code).toUpperCase(),expected_version});
  const room=findRoom(db,String(code).toUpperCase(),playerId,false);
  return processOnce(db,playerId,command_id,room.id,()=>{
   openRoom(room);checkVersion(room,expected_version);
   const all=members(db,room.id);
   assert(!all.some(m=>m.player_id===playerId),409,'ALREADY_JOINED');
   assert(all.length<2,409,'ROOM_FULL');
   db.prepare('INSERT INTO multiplayer_members VALUES(?,?,?,?,?)').run(room.id,playerId,2,0,now());
   const updated=stamp(db,room);
   return {room:view(db,updated,playerId),balance:wallet(db,playerId)};
  });
 });
}
function diceResult(){
 const rolls=[];let first,second;
 // Ties are replayed (no tie payout), guaranteed finite via independent CSPRNG draws.
 do {first=randomInt(1,7);second=randomInt(1,7);rolls.push([first,second]);}while(first===second);
 return {rolls,dice:[first,second],winning_seat:first>second?1:2};
}
export function roomAction(db,playerId,id,{action,expected_version,command_id}={}){
 return transaction(db,()=>{
  // Replay must work even after LEAVE removed the actor's membership.
  commandId(command_id);
  bindCommand(db,playerId,command_id,{operation:'room.action',id,action,expected_version});
  const already=db.prepare('SELECT room_id,response_json FROM multiplayer_commands WHERE tenant_id=? AND player_id=? AND command_id=?').get('wa-world',playerId,command_id);
  if(already){assert(already.room_id===id,409,'COMMAND_REUSED_FOR_OTHER_ROOM');return parse(already.response_json);}
  const room=findRoom(db,id,playerId);
  return processOnce(db,playerId,command_id,room.id,()=>{
   openRoom(room);checkVersion(room,expected_version);
   const all=members(db,room.id);
   if(action==='READY'){
    const me=all.find(m=>m.player_id===playerId);
    db.prepare('UPDATE multiplayer_members SET ready=1 WHERE room_id=? AND player_id=?').run(room.id,playerId);
    const updated=stamp(db,room);return {room:view(db,updated,playerId),balance:wallet(db,playerId)};
   }
   if(action==='LEAVE'){
    assert(room.host_id!==playerId,409,'HOST_MUST_CANCEL');
    db.prepare('DELETE FROM multiplayer_members WHERE room_id=? AND player_id=?').run(room.id,playerId);
    // Guest left: remaining host must confirm READY again.
    db.prepare('UPDATE multiplayer_members SET ready=0 WHERE room_id=?').run(room.id);
    const updated=stamp(db,room);return {room:view(db,updated,playerId),balance:wallet(db,playerId)};
   }
   if(action==='CANCEL'){
    assert(room.host_id===playerId,403,'HOST_ONLY');
    const updated=stamp(db,room,{status:'CANCELLED'});return {room:view(db,updated,playerId),balance:wallet(db,playerId)};
   }
   if(action==='START'){
    assert(room.host_id===playerId,403,'HOST_ONLY');
    assert(all.length===2&&all.every(m=>m.ready),409,'PLAYERS_NOT_READY');
    // Never settle when either player cannot cover the fixed game stake.
    const ids=all.map(m=>accountId(db,m.player_id));
    const balances=all.map(m=>wallet(db,m.player_id));
    assert(balances.every(v=>v>=room.bet),409,'INSUFFICIENT_ACR');
    const result=diceResult();
    for(let i=0;i<2;i++)transfer(db,{from:ids[i],to:'wa-treasury',amount:room.bet,eventKey:`room:${room.id}:seat:${i+1}`,reason:'T0 Dice Duel entry'});
    const winner=all[result.winning_seat-1];
    transfer(db,{from:'wa-treasury',to:accountId(db,winner.player_id),amount:2*room.bet,eventKey:`room:${room.id}:prize`,reason:'T0 Dice Duel prize'});
    const safeResult={...result,payout:2*room.bet,net_for_winner:room.bet,finished_ms:now()};
    const updated=stamp(db,room,{status:'FINISHED',result:safeResult});
    return {room:view(db,updated,playerId),balance:wallet(db,playerId)};
   }
   fail(400,'INVALID_ROOM_ACTION');
  });
 });
}
