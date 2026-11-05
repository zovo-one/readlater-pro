// Classic (non-module) service worker: load the shared classification first.
importScripts(chrome.runtime.getURL('membership/eligibility.js'));
(function(){'use strict';
const api=globalThis.ZovoSubscriptionMembership;
// Updated synchronously on oldValue before any asynchronous persistence begins.
let member=false,recovery=false,readFailed=false,trialUntil=0;
let queue=Promise.resolve();
function capture(area,key,value){const kind=api.kindOf(area,key,value);if(kind==='free')return false;if(kind==='member')member=true;else if(kind==='trial')trialUntil=Math.max(trialUntil,api.trialExpiry(area,key,value));else recovery=true;return true;}
async function persist(){const flags={};if(member)flags[api.MEMBER]=true;if(recovery)flags[api.RECOVERY]=true;if(trialUntil>0)flags[api.TRIAL]=trialUntil;if(!Object.keys(flags).length)return;
 let durable=false;try{await chrome.storage.local.set(flags);durable=true;}catch{readFailed=true;}
 // Session fallback survives service-worker suspension when local persistence fails.
 try{await chrome.storage.session.set(flags);}catch{if(!durable)readFailed=true;}
}
function schedule(){queue=queue.then(persist).catch(()=>{readFailed=true;});}
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'){
  if(typeof changes[api.TRIAL]?.newValue==='number'&&Number.isFinite(changes[api.TRIAL].newValue))trialUntil=Math.max(trialUntil,changes[api.TRIAL].newValue);
  if(changes[api.MEMBER]?.newValue===true)member=true;if(changes[api.RECOVERY]?.newValue===true)recovery=true;
 }
 let hit=false;for(const key of (api.WATCH[area]||[])){const change=changes[key];if(!change)continue;const old=capture(area,key,change.oldValue),next=capture(area,key,change.newValue);if(old||next)hit=true;}
 if(hit)schedule();
});
const initialized=(async()=>{try{const values=await api.readValues();const data=values.local;if(data[api.TRIAL]!==undefined){if(typeof data[api.TRIAL]==='number'&&Number.isFinite(data[api.TRIAL]))trialUntil=Math.max(trialUntil,data[api.TRIAL]);else readFailed=true;}member=member||data[api.MEMBER]===true||data[api.CAMPAIGN]?.memberSeen===true;recovery=recovery||data[api.RECOVERY]===true||data[api.CAMPAIGN]?.recoverySeen===true;for(const s of api.SOURCES)capture(s.area,s.key,values[s.area]?values[s.area][s.key]:undefined);}catch{readFailed=true;}
try{const data=await chrome.storage.session.get([api.MEMBER,api.RECOVERY,api.TRIAL]);if(data[api.TRIAL]!==undefined){if(typeof data[api.TRIAL]==='number'&&Number.isFinite(data[api.TRIAL]))trialUntil=Math.max(trialUntil,data[api.TRIAL]);else readFailed=true;}member=member||data[api.MEMBER]===true;recovery=recovery||data[api.RECOVERY]===true;}catch{readFailed=true;}schedule();})();
async function status(){await initialized;try{const values=await api.readValues();let hit=false;for(const s of api.SOURCES)if(capture(s.area,s.key,values[s.area]?values[s.area][s.key]:undefined))hit=true;if(hit)schedule();}catch{readFailed=true;}
// Do not wait for potentially delayed writes: the volatile guard already has the result.
return member?'member':recovery||readFailed?'unknown':trialUntil>Date.now()?'trial':'free';}
chrome.runtime.onConnect.addListener(port=>{if(port.name!==api.PORT)return;port.onMessage.addListener(message=>{if(message?.request!=='status')return;void status().then(value=>{try{port.postMessage({campaign:api.CAMPAIGN,status:value});}catch{}});});});
})();
