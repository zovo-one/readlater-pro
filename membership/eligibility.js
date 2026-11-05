(function(root){'use strict';
// ReadLater Pro licence model (read from src/utils/license-manager.js and secure-storage.js, unchanged):
//   chrome.storage.local.licenseDataPlain = {valid, tier:'free'|'pro'|'lifetime', features, expiresAt, licenseKey, origin:'server'|'local', cachedAt, verifiedAt}
//   chrome.storage.local.licenseData      = AES-GCM blob {iv, ciphertext, _encrypted:true} of the same record (unreadable here)
//   chrome.storage.local.licenseKey       = plain key string or an encrypted blob; retained when the cache is purged
//   chrome.storage.local.userTier         = legacy tier string watched by the product's tamper watchdog
// The worker calls purgeIfUntrusted() at import time (drops licenseDataPlain/licenseData when verifiedAt is older than 24h)
// and verifyAndStore() overwrites the cache with the server answer, so a prior member is captured from oldValue by
// observer.js, which is imported BEFORE license-manager.js via an importScripts prefix line.
const CAMPAIGN="zovo.membership.readlater.v1",PRODUCT="ReadLater Pro",CARD="Keep your reading list yours. Help me keep improving ReadLater Pro.",DAYS30=30*86400000;
const SOURCES=[{area:'local',key:'licenseDataPlain'},{area:'local',key:'licenseData'},{area:'local',key:'licenseKey'},{area:'local',key:'userTier'}];
const WATCH={local:['licenseDataPlain','licenseData','licenseKey','userTier'],sync:[]};
function expiryOf(v){if(typeof v==='number')return Number.isFinite(v)?v:NaN;if(typeof v==='string'&&v){const t=new Date(v).getTime();return Number.isFinite(t)?t:NaN;}return NaN;}
function recordKind(record,now){
 if(record===undefined||record===null)return 'free';
 if(typeof record!=='object'||Array.isArray(record))return 'unknown';
 if(record._encrypted===true)return 'unknown';
 if(record.tier==='trial'){const until=expiryOf(record.trialExpires??record.expiresAt);return Number.isFinite(until)&&until>now?'trial':'unknown';}
 if(record.valid===true||record.isPro===true)return 'member';
 if(typeof record.tier==='string'&&record.tier&&record.tier!=='free')return 'member';
 if(record.tier!==undefined&&record.tier!==null&&record.tier!=='free')return 'unknown';
 if(record.valid!==undefined&&record.valid!==null&&record.valid!==false)return 'unknown';
 if(record.licenseKey!==undefined&&record.licenseKey!==null&&record.licenseKey!=='')return 'unknown';
 for(const key of ['cachedAt','verifiedAt'])if(record[key]!==undefined&&record[key]!==null&&typeof record[key]!=='number')return 'unknown';
 return 'free';
}
function keyKind(key){if(key===undefined||key===null||key==='')return 'free';return 'unknown';}
function tierKind(tier){if(tier===undefined||tier===null||tier===''||tier==='free')return 'free';if(tier==='pro'||tier==='lifetime')return 'member';return 'unknown';}
function kindOf(area,key,value,now){now=now||Date.now();if(area!=='local')return 'free';if(key==='licenseDataPlain')return recordKind(value,now);if(key==='licenseData')return value===undefined||value===null?'free':'unknown';if(key==='licenseKey')return keyKind(value);if(key==='userTier')return tierKind(value);return 'free';}
function trialExpiry(area,key,value){if(area==='local'&&key==='licenseDataPlain'&&value&&typeof value==='object'&&value.tier==='trial'){const until=expiryOf(value.trialExpires??value.expiresAt);return Number.isFinite(until)?until:0;}return 0;}
function combine(kinds){if(kinds.includes('member'))return 'member';if(kinds.includes('unknown'))return 'unknown';if(kinds.includes('trial'))return 'trial';return 'free';}
function subscriptionKind(values,now){now=now||Date.now();return combine(SOURCES.map(s=>kindOf(s.area,s.key,values&&values[s.area]?values[s.area][s.key]:undefined,now)));}
function classify(values,state,now){const kind=subscriptionKind(values,now);if(kind!=='free')return kind;
 if(state!==undefined&&state!==null){if(typeof state!=='object'||Array.isArray(state))return 'unknown';if(state.memberSeen)return 'member';if(state.recoverySeen)return 'unknown';if(state.hidden===true)return 'dismissed';if(state.dismissedAt!==undefined&&(typeof state.dismissedAt!=='number'||!Number.isFinite(state.dismissedAt)))return 'unknown';if(state.dismissedAt&&now-state.dismissedAt<DAYS30)return 'dismissed';}return 'free';}
const MEMBER=CAMPAIGN+'.memberSeen',RECOVERY=CAMPAIGN+'.recoverySeen',TRIAL=CAMPAIGN+'.trialUntil',PORT=CAMPAIGN+'.status';
// Dedicated flags are monotonic and cannot be overwritten by a dismissal RMW.
function requestWorkerStatus(){return new Promise(resolve=>{let port,done=false;const finish=status=>{if(done)return;done=true;clearTimeout(timer);try{port?.disconnect();}catch{}resolve(status);};const timer=setTimeout(()=>finish('unknown'),2500);try{port=chrome.runtime.connect({name:PORT});port.onMessage.addListener(message=>{finish(message&&message.campaign===CAMPAIGN&&['free','member','trial','unknown'].includes(message.status)?message.status:'unknown');});port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;finish('unknown');});port.postMessage({request:'status'});}catch{finish('unknown');}});}
async function readValues(){const values={local:{},sync:{}};values.local=await chrome.storage.local.get([...WATCH.local,CAMPAIGN,MEMBER,RECOVERY,TRIAL]);if(WATCH.sync.length)values.sync=await chrome.storage.sync.get(WATCH.sync);return values;}
async function read(){try{const values=await readValues();const data=values.local;const now=Date.now();const localKind=classify(values,data[CAMPAIGN],now);if(data[MEMBER]===true)return 'member';if(data[RECOVERY]===true)return 'unknown';if(data[TRIAL]!==undefined&&(typeof data[TRIAL]!=='number'||!Number.isFinite(data[TRIAL])))return 'unknown';if(data[TRIAL]>now)return 'trial';const workerKind=await requestWorkerStatus();if(workerKind!=='free')return workerKind;return localKind;}catch{return 'unknown';}}
// "Hide these notes" is monotonic: a later "Not now" (30-day cooldown) never re-enables the card.
async function dismiss(forever){const data=await chrome.storage.local.get(CAMPAIGN);const prior=data[CAMPAIGN]&&typeof data[CAMPAIGN]==='object'&&!Array.isArray(data[CAMPAIGN])?data[CAMPAIGN]:{};await chrome.storage.local.set({[CAMPAIGN]:{...prior,dismissedAt:Date.now(),hidden:forever===true||prior.hidden===true}});}
function touches(changes,area){if(area==='local'){if(changes[CAMPAIGN]||changes[MEMBER]||changes[RECOVERY]||changes[TRIAL])return true;}const keys=WATCH[area]||[];return keys.some(k=>changes[k]);}
root.ZovoSubscriptionMembership={CAMPAIGN,PRODUCT,CARD,SOURCES,WATCH,kindOf,trialExpiry,combine,subscriptionKind,recordKind,classify,read,readValues,dismiss,touches,MEMBER,RECOVERY,TRIAL,PORT};
})(globalThis);
