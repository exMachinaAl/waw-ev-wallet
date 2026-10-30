import {postTransfer as transfer} from './val/ledger.mjs';
import {randomBytes,createHmac} from 'node:crypto';
import {assert,uuid,now,json,parse,digest,fail} from './util.mjs';
import {transaction,accountId,wallet} from './db.mjs';
import {policy,checkStake,tenantFor,once,reserve,releaseReserve} from './stake-policy.mjs';
export const lotteryEnabled=()=>process.env.LOTTERY_ENABLED==='true';
const requireEnabled=()=>assert(lotteryEnabled(),403,'LOTTERY_DISABLED');
export function lotteryNumber(seed,id,digits){let out='',counter=0;while(out.length<digits){const bytes=createHmac('sha256',Buffer.from(seed,'hex')).update(`WAE-L1-v1:${id}:${counter++}`).digest();for(const b of bytes){if(b<250)out+=String(b%10);if(out.length===digits)break;}}return out;}
export function lotteryPrize(guess,result,rules){assert(typeof guess==='string'&&guess.length===result.length&&/^[0-9]{4,32}$/.test(guess),400,'INVALID_DRAW_DIGITS');let matched=0;while(matched<guess.length&&guess[matched]===result[matched])matched++;if(matched<4)return {matched,payout:0};
 const k=BigInt(matched-4),num=BigInt(rules.base_prize)*3n**k,den=2n**k;const rounded=(num+den/2n)/den;return {matched,payout:Number(rounded>BigInt(rules.max_prize)?BigInt(rules.max_prize):rounded)};}
const find=(db,id)=>{const r=db.prepare("SELECT * FROM lottery_campaigns WHERE id=? AND tenant_id='wa-world'").get(id);assert(r,404,'DRAW_NOT_FOUND');return r;};
export function roundAudit(db,id,actor,event,detail={}){db.prepare('INSERT INTO round_audit(round_id,actor,event,detail_json,created_ms) VALUES(?,?,?,?,?)').run(id,actor,event,json(detail),now());}
export function roundEvent(db,id,players,type,version,payload){for(const p of new Set(players))db.prepare('INSERT INTO outbox(tenant_id,player_id,session_id,event_type,version,payload_json,created_ms) VALUES(?,?,?,?,?,?,?)').run('wa-world',p,id,type,version,json(payload),now());}
function stamp(db,r,status,actor,detail={}){db.prepare('UPDATE lottery_campaigns SET status=?,version=version+1 WHERE id=? AND version=?').run(status,r.id,r.version);roundAudit(db,r.id,actor,status,detail);return find(db,r.id);}
export function lotteryView(db,id,p=null,admin=false){const r=find(db,id),rules=parse(r.rules_json),c=db.prepare('SELECT * FROM draw_commits WHERE round_id=?').get(id);const counts=db.prepare('SELECT COUNT(*) tickets,COUNT(DISTINCT player_id) participants FROM lottery_tickets WHERE round_id=?').get(id);
 const tickets=p?db.prepare('SELECT t.id,t.guess,t.cost,t.status,t.created_ms,s.matched,s.payout FROM lottery_tickets t LEFT JOIN lottery_settlements s ON s.ticket_id=t.id WHERE t.round_id=? AND t.player_id=? ORDER BY t.created_ms').all(id,p):[];
 const revealed=c.revealed_ms!==null;return {...r,rules_json:undefined,rules,...counts,commitment:c.commitment,seed:revealed?c.seed:undefined,algorithm:'HMAC-SHA256(WAE-L1-v1:round_id:counter), bytes <250 mod 10',tickets_mine:tickets,reserved:db.prepare('SELECT amount FROM treasury_reserves WHERE id=?').get(id)?.amount??0,
 winners:revealed?db.prepare('SELECT t.id ticket_id,s.matched,s.payout FROM lottery_tickets t JOIN lottery_settlements s ON s.ticket_id=t.id WHERE t.round_id=? AND s.payout>0').all(id):[],
 ...(admin?{audit:db.prepare('SELECT * FROM round_audit WHERE round_id=? ORDER BY id').all(id)}:{})};}
export function lotteryList(db,p){if(p)tenantFor(db,p);return {enabled:lotteryEnabled(),rounds:db.prepare("SELECT id FROM lottery_campaigns WHERE tenant_id='wa-world' ORDER BY created_ms DESC LIMIT 100").all().map(r=>lotteryView(db,r.id,p)),legacy:p?db.prepare("SELECT *, 'LEGACY_INSTANT_DRAW' AS history_type FROM number_draw_plays WHERE player_id=? AND tenant_id='wa-world' ORDER BY created_ms DESC LIMIT 100").all(p):[]};}
export function createLottery(db,admin,b){requireEnabled();assert(admin?.role==='ADMIN',403,'ADMIN_REQUIRED');assert(!b.tenant_id||b.tenant_id==='wa-world',403,'TENANT_NOT_SUPPORTED');return once(db,admin.id,b.command_id,b,()=>{
 const pol=policy(db,'L1'),digits=b.digits??4,price=b.price??10,base_prize=b.base_prize??100,max_prize=b.max_prize??500,budget=b.budget??10000,per_player=b.per_player??3,capacity=b.capacity??20;
 checkStake(price,pol);assert(Number.isInteger(digits)&&digits>=4&&digits<=pol.maxDigits,400,'INVALID_DIGITS');
 for(const v of [base_prize,max_prize,budget,per_player,capacity])assert(Number.isSafeInteger(v)&&v>0&&v<=100000000,400,'INVALID_RULES');
 assert(per_player<=100&&capacity<=10000&&max_prize>=base_prize&&budget>=Math.max(price,max_prize),400,'INVALID_BUDGET');
 assert(typeof b.title==='string'&&b.title.trim().length>=3&&b.title.length<=100,400,'INVALID_TITLE');
 const opens=b.opens_ms??now(),closes=b.closes_ms,publishes=b.publishes_ms;assert([opens,closes,publishes].every(Number.isSafeInteger)&&closes>opens&&publishes>=closes&&closes>now(),400,'INVALID_SCHEDULE');
 const id=uuid(),seed=randomBytes(32).toString('hex'),rules={version:'PREFIX_3_2_V1',digits,price,base_prize,max_prize,budget,per_player,capacity,early_release:b.early_release===true,cancel_tickets:b.cancel_tickets===true,policy:pol,rounding:'nearest integer, half up; once after rational multiplication',base_prize_basis:'fixed ACR, independent of price',min_match:4,multiplier:'3/2',timezone:'UTC'};
 db.prepare('INSERT INTO lottery_campaigns VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'wa-world',b.title.trim(),'DRAFT',1,json(rules),opens,closes,publishes,null,now());
 db.prepare('INSERT INTO draw_commits VALUES(?,?,?,NULL)').run(id,digest(seed),seed);roundAudit(db,id,admin.id,'DRAFT',{commitment:digest(seed),rules});return lotteryView(db,id,null,true);
 });}
function openDraw(db,r,actor){const rules=parse(r.rules_json);assert(r.status==='DRAFT',409,'DRAW_NOT_DRAFT');reserve(db,r.id,rules.budget);return stamp(db,r,'OPEN',actor);}
export function buyLotteryTicket(db,p,id,b){requireEnabled();tenantFor(db,p);return once(db,p,b.command_id,{id,...b},()=>{const r=find(db,id),rules=parse(r.rules_json);assert(r.status==='OPEN'&&now()>=r.opens_ms&&now()<r.closes_ms,409,'DRAW_ENTRY_CLOSED');assert(typeof b.guess==='string'&&new RegExp(`^[0-9]{${rules.digits}}$`).test(b.guess),400,'INVALID_DRAW_DIGITS');
 const n=db.prepare("SELECT COUNT(*) n FROM lottery_tickets WHERE round_id=? AND status<>'REFUNDED'").get(id).n,own=db.prepare("SELECT COUNT(*) n FROM lottery_tickets WHERE round_id=? AND player_id=? AND status<>'REFUNDED'").get(id,p).n;
 assert(n<rules.capacity&&own<rules.per_player,409,'TICKET_QUOTA');assert((n+1)*Math.max(rules.max_prize,rules.price)<=rules.budget,409,'LIABILITY_LIMIT');
 const tid=uuid();transfer(db,{from:accountId(db,p),to:'wa-treasury',amount:rules.price,eventKey:`lottery:${tid}:entry`,reason:'Lottery Exclusive ticket'});
 db.prepare('INSERT INTO lottery_tickets VALUES(?,?,?,?,?,?,?)').run(tid,id,p,b.guess,rules.price,'CONFIRMED',now());stamp(db,r,'OPEN',p,{ticket_id:tid});return {ticket_id:tid,round:lotteryView(db,id,p),balance:wallet(db,p)};});}
export function cancelLotteryTicket(db,p,id,b){tenantFor(db,p);return once(db,p,b.command_id,{id,...b},()=>{const r=find(db,id),rules=parse(r.rules_json);assert(r.status==='OPEN'&&now()<r.closes_ms&&rules.cancel_tickets,409,'TICKET_CANNOT_CANCEL');const t=db.prepare('SELECT * FROM lottery_tickets WHERE id=? AND round_id=? AND player_id=?').get(b.ticket_id,id,p);assert(t,404,'TICKET_NOT_FOUND');if(t.status!=='REFUNDED'){
 // Free just this refund from the full budget, then restore the budget from returned ticket stakes.
 releaseReserve(db,id);transfer(db,{from:'wa-treasury',to:accountId(db,p),amount:t.cost,eventKey:`lottery:${t.id}:refund`,reason:'Lottery ticket cancelled'});reserve(db,id,rules.budget);db.prepare("UPDATE lottery_tickets SET status='REFUNDED' WHERE id=?").run(t.id);stamp(db,r,'OPEN',p,{refund:t.id});}
 return {round:lotteryView(db,id,p),balance:wallet(db,p)};});}
function publish(db,r,actor){assert(['CLOSED','DRAWING','PUBLISHED'].includes(r.status),409,'CLOSE_ENTRY_FIRST');const rules=parse(r.rules_json),seed=db.prepare('SELECT seed FROM draw_commits WHERE round_id=?').get(r.id).seed,result=lotteryNumber(seed,r.id,rules.digits);
 if(r.status==='CLOSED')r=stamp(db,r,'DRAWING',actor);
 db.prepare('UPDATE lottery_campaigns SET result=? WHERE id=?').run(result,r.id);db.prepare('UPDATE draw_commits SET revealed_ms=COALESCE(revealed_ms,?) WHERE round_id=?').run(now(),r.id);
 r=stamp(db,r,'PUBLISHED',actor,{result});releaseReserve(db,r.id);
 const tickets=db.prepare("SELECT * FROM lottery_tickets WHERE round_id=? AND status='CONFIRMED'").all(r.id);
 for(const t of tickets){const {matched,payout}=lotteryPrize(t.guess,result,rules);if(payout)transfer(db,{from:'wa-treasury',to:accountId(db,t.player_id),amount:payout,eventKey:`lottery:${t.id}:prize`,reason:'Lottery Exclusive payout'});
 db.prepare('INSERT OR IGNORE INTO lottery_settlements VALUES(?,?,?,?)').run(t.id,matched,payout,now());db.prepare("UPDATE lottery_tickets SET status='SETTLED' WHERE id=?").run(t.id);}
 r=stamp(db,r,'SETTLED',actor);roundEvent(db,r.id,tickets.map(t=>t.player_id),'lottery.published',r.version,{round_id:r.id,result});return r;
}
export function lotteryAdminAction(db,admin,id,b){assert(admin?.role==='ADMIN',403,'ADMIN_REQUIRED');return once(db,admin.id,b.command_id,{id,...b},()=>{let r=find(db,id),rules=parse(r.rules_json);assert(Number.isSafeInteger(b.expected_version)&&b.expected_version===r.version,409,'ROUND_STATE_STALE');
 if(b.action==='OPEN'){requireEnabled();r=openDraw(db,r,admin.id);}
 else if(b.action==='CLOSE'){assert(r.status==='OPEN',409,'DRAW_NOT_OPEN');assert(now()>=r.closes_ms||rules.early_release,409,'EARLY_RELEASE_DISABLED');r=stamp(db,r,'CLOSED',admin.id,{early:now()<r.closes_ms});}
 else if(b.action==='PUBLISH'){assert(now()>=r.publishes_ms||rules.early_release,409,'EARLY_RELEASE_DISABLED');r=publish(db,r,admin.id);}
 else if(b.action==='CANCEL'){assert(['DRAFT','OPEN','CLOSED'].includes(r.status),409,'CANNOT_CANCEL_PUBLISHED');releaseReserve(db,id);const tickets=db.prepare("SELECT * FROM lottery_tickets WHERE round_id=? AND status='CONFIRMED'").all(id);for(const t of tickets){transfer(db,{from:'wa-treasury',to:accountId(db,t.player_id),amount:t.cost,eventKey:`lottery:${t.id}:refund`,reason:'Lottery cancelled refund'});db.prepare("UPDATE lottery_tickets SET status='REFUNDED' WHERE id=?").run(t.id);}r=stamp(db,r,'CANCELLED',admin.id);roundEvent(db,id,tickets.map(t=>t.player_id),'lottery.cancelled',r.version,{round_id:id});}
 else fail(400,'INVALID_DRAW_ACTION');return lotteryView(db,id,null,true);});}
export function sweepLottery(db){for(const row of db.prepare("SELECT id FROM lottery_campaigns WHERE status IN ('OPEN','CLOSED','DRAWING','PUBLISHED')").all())transaction(db,()=>{let r=find(db,row.id);if(r.status==='OPEN'&&now()>=r.closes_ms)r=stamp(db,r,'CLOSED','scheduler');if(['DRAWING','PUBLISHED'].includes(r.status)||(r.status==='CLOSED'&&now()>=r.publishes_ms))publish(db,r,'scheduler');});}
