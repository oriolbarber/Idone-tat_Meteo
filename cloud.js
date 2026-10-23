"use strict";
/* ============ CEM · comptes, propostes de parets i revisió (Firebase) ============
   - Sense compte, l'app funciona igual: es miren les zones, es traça al mòbil i es veuen les parets aprovades.
   - Les parets aprovades (col·lecció «parets», lectura pública) es llegeixen amb l'API REST de Firestore,
     sense descarregar Firebase. Firebase només es carrega si en aquest mòbil ja s'havia entrat, si s'obre
     un enllaç d'accés o si es prem un botó del compte.
   - Proposar una paret: compte amb el correu confirmat + acceptar la llicència ODbL 1.0. Queda pendent
     fins que la revisa l'administració, un revisor o un premium.
   Firestore no accepta llistes dins de llistes: el traçat i els trams van com a JSON al camp «d». */
(() => {
const FB_VER = "13.0.0";
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
const FB_CONFIG = {
  apiKey: "AIzaSyCHZXN2YU9Eotz0PnWrHgmVrgFvzc_4mic",
  authDomain: "cem-meteo.firebaseapp.com",
  projectId: "cem-meteo",
  storageBucket: "cem-meteo.firebasestorage.app",
  messagingSenderId: "395521875199",
  appId: "1:395521875199:web:8d6f0247d9b6a04d5900ca"
};
const OWNER_EMAIL = "oriolbarber@gmail.com";   // administració inicial (també a firestore.rules); cal tenir el correu confirmat
const CONSENT_V = "2026-10-23";                // canvia-la si canvia el text de privadesa
const LIC = "ODbL-1.0";
const PUB_TTL = 3 * 3600e3;                    // cada quan es tornen a llegir les parets aprovades

let A = null, F = null, app = null, auth = null, db = null, loading = null, fsLoading = null;
let user = null, prof = null, isAdm = false, isRev = false, ready = false;
let pending = [], authors = {}, licWall = null, flash = {t:"", err:false}, rejecting = null;
let mode = store.get("cem_had") ? "entra" : "alta";

const say = (t, err) => { flash = {t, err:!!err};
  document.querySelectorAll("[data-accmsg]").forEach(m => { m.textContent = t; m.hidden = !t; m.classList.toggle("err", !!err); if(t) m.scrollIntoView({block:"nearest", behavior:"smooth"}); }); };
const T = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({code:"timeout"}), ms))]);
const ERR = {
  "auth/network-request-failed": "Sense connexió. Torna-ho a provar quan en tinguis.",
  "auth/operation-not-allowed": "Aquest mètode d'entrada no està activat a Firebase (Authentication ▸ Mètode d'inici de sessió).",
  "auth/unauthorized-domain": "Aquest domini no està autoritzat a Firebase (Authentication ▸ Configuració ▸ Dominis autoritzats).",
  "auth/unauthorized-continue-uri": "Aquest domini no està autoritzat a Firebase (Authentication ▸ Configuració ▸ Dominis autoritzats).",
  "auth/invalid-email": "El correu no és vàlid.",
  "auth/invalid-action-code": "L'enllaç ja s'ha fet servir o ha caducat. Demana'n un de nou.",
  "auth/expired-action-code": "L'enllaç ha caducat. Demana'n un de nou.",
  "auth/invalid-credential": "Correu o contrasenya incorrectes. Si entraves amb un enllaç, prem «He oblidat la contrasenya» per posar-ne una.",
  "auth/wrong-password": "Contrasenya incorrecta.",
  "auth/user-not-found": "No hi ha cap compte amb aquest correu. Fes-te'n un a «Alta nova».",
  "auth/email-already-in-use": "Aquest correu ja té compte. Ves a «Entra» i, si cal, prem «He oblidat la contrasenya».",
  "auth/weak-password": "La contrasenya ha de tenir almenys 6 caràcters.",
  "auth/missing-password": "Escriu la contrasenya.",
  "auth/too-many-requests": "Massa intents seguits. Espera uns minuts.",
  "auth/requires-recent-login": "Per seguretat, torna a entrar i repeteix-ho de seguida.",
  "permission-denied": "La base de dades ho ha refusat. Comprova que les regles de firestore.rules estan publicades a Firebase.",
  "timeout": "La base de dades no respon. Comprova la connexió; un bloquejador d'anuncis també ho pot impedir.",
  "unavailable": "Sense connexió amb el núvol. Torna-ho a provar més tard."
};
const errText = e => ERR[e && e.code] || "No s'ha pogut fer" + (e && e.code ? " (" + e.code + ")." : ".");
const mailOk = m => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m);
const val = id => ($(id) && $(id).value || "").trim();

/* ---------- parets aprovades: API REST pública (sense Firebase) ---------- */
function wallFromDoc(id, f){
  try{ const d = JSON.parse(f.d); return {id, zone:f.zone, name:f.name || "Paret", exp:f.exp || "exposat", pts:d.pts, segs:d.segs, src:"cloud"}; }catch(e){ return null; }
}
async function fetchPublic(force){
  if(!force && Date.now() - store.get("cem_cloud_at", 0) < PUB_TTL) return;
  const base = `https://firestore.googleapis.com/v1/projects/${FB_CONFIG.projectId}/databases/(default)/documents/parets?pageSize=300&key=${FB_CONFIG.apiKey}`;
  const out = []; let tok = "";
  try{
    do{
      const r = await fetch(base + (tok ? "&pageToken=" + encodeURIComponent(tok) : ""));
      if(!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      (j.documents || []).forEach(doc => {
        const f = {}; Object.entries(doc.fields || {}).forEach(([k, v]) => f[k] = v.stringValue ?? v.integerValue ?? v.doubleValue ?? null);
        const w = wallFromDoc(doc.name.split("/").pop(), f); if(w) out.push(w);
      });
      tok = j.nextPageToken || "";
    }while(tok);
    cloudWalls = out; store.set("cem_cloud_walls", out); store.set("cem_cloud_at", Date.now());
    cache.clear(); renderWalls(); renderAll(); renderPanels();
  }catch(e){ /* sense connexió: queden les desades */ }
}

/* ---------- càrrega de Firebase (a demanda) ---------- */
function load(){
  if(loading) return loading;
  loading = (async () => {
    const [fa, a] = await Promise.all([import(FB_BASE + "firebase-app.js"), import(FB_BASE + "firebase-auth.js")]);
    A = a; app = fa.initializeApp(FB_CONFIG);
    auth = a.initializeAuth(app, {persistence:[a.indexedDBLocalPersistence, a.browserLocalPersistence]});
    auth.languageCode = "ca";
    await handleLink();
    await auth.authStateReady();
    a.onAuthStateChanged(auth, onUser);
  })().catch(e => { loading = null; throw e; });
  return loading;
}
function fs(){
  if(fsLoading) return fsLoading;
  fsLoading = import(FB_BASE + "firebase-firestore.js").then(f => { F = f; db = f.initializeFirestore(app, {ignoreUndefinedProperties:true}); return f; })
    .catch(e => { fsLoading = null; throw e; });
  return fsLoading;
}

/* ---------- sessió i perfil ---------- */
const verified = () => !!(user && user.emailVerified);
async function onUser(u){
  user = u; prof = null; isAdm = false; isRev = false; pending = [];
  if(!u){ store.set("cem_cloud", 0); ready = true; render(); badges(); return; }
  store.set("cem_cloud", 1); store.set("cem_had", 1); mode = "entra";
  try{
    await readProfile();
    if(!prof){ const c = store.get("cem_consent"); if(c && c.v === CONSENT_V) await createProfile(c.nom); }
    await refreshMine();
    if(isRev) await refreshPending();
  }catch(e){ say(errText(e), true); }
  ready = true; render(); badges();
}
async function readProfile(){
  const f = await fs();
  const own = user.email === OWNER_EMAIL && user.emailVerified;
  isAdm = own || await f.getDoc(f.doc(db, "admins", user.uid)).then(d => d.exists(), () => false);
  const snap = await T(f.getDoc(f.doc(db, "usuaris", user.uid)));
  prof = snap.exists() ? snap.data() : null;
  isRev = isAdm || !!(prof && (prof.rol === "revisor" || prof.premium === true));
}
async function createProfile(nom){
  const f = await fs(), mail = user.email || "";
  const n = String(nom || mail.split("@")[0] || "Persona escaladora").trim().replace(/\s+/g, " ").slice(0, 80);
  await T(f.setDoc(f.doc(db, "usuaris", user.uid), {nom:n, email:mail, rol:"registrat", consentVersio:CONSENT_V, consentAt:f.serverTimestamp(), creat:f.serverTimestamp()}));
  store.set("cem_consent", null);
  await readProfile();
}
function consentFromForm(){
  if(mode === "entra") return true;
  if(!$("accConsent") || !$("accConsent").checked){ say("Per crear el compte cal marcar la casella d'acceptació.", true); return false; }
  store.set("cem_consent", {v:CONSENT_V, nom:val("accName")});
  return true;
}

/* ---------- entrar, alta i sortir ---------- */
async function passLogin(){
  const mail = val("accMail").toLowerCase(), pw = $("accPass") ? $("accPass").value : "";
  if(!mailOk(mail)){ say("Escriu un correu vàlid.", true); return; }
  if(!pw){ say("Escriu la contrasenya.", true); return; }
  say("Entrant…");
  try{ await load(); await A.signInWithEmailAndPassword(auth, mail, pw); say(""); }catch(e){ say(errText(e), true); }
}
async function passCreate(){
  const mail = val("accMail").toLowerCase(), pw = $("accPass").value, pw2 = $("accPass2").value;
  if(!val("accName")){ say("Escriu el teu nom.", true); return; }
  if(!mailOk(mail)){ say("Escriu un correu vàlid.", true); return; }
  if(pw.length < 6){ say("La contrasenya ha de tenir almenys 6 caràcters.", true); return; }
  if(pw !== pw2){ say("Les dues contrasenyes no coincideixen.", true); return; }
  if(!consentFromForm()) return;
  say("Creant el compte…");
  try{ await load(); const c = await A.createUserWithEmailAndPassword(auth, mail, pw);
    try{ await A.sendEmailVerification(c.user, {url: linkUrl()}); }catch(e){}
    say(`Compte creat. T'hem enviat un correu a ${mail} per confirmar-lo: obre'l per poder proposar parets. Mira també el correu brossa.`); }
  catch(e){ store.set("cem_consent", null); say(errText(e), true); }
}
async function passReset(){
  const mail = val("accMail").toLowerCase();
  if(!mailOk(mail)){ say("Escriu primer el teu correu a dalt.", true); return; }
  say("Enviant…");
  try{ await load(); await A.sendPasswordResetEmail(auth, mail); say(`Si ${mail} té compte, t'hi arribarà un correu per posar una contrasenya nova. Mira també el correu brossa.`); }
  catch(e){ say(errText(e), true); }
}
const linkUrl = () => location.origin + location.pathname;
async function sendLink(){
  const mail = val("accMail").toLowerCase();
  if(!mailOk(mail)){ say("Escriu un correu vàlid.", true); return; }
  if(mode === "alta" && !val("accName")){ say("Escriu el teu nom.", true); return; }
  if(!consentFromForm()) return;
  say("Enviant l'enllaç…");
  try{ await load(); await A.sendSignInLinkToEmail(auth, mail, {url: linkUrl(), handleCodeInApp:true});
    store.set("cem_link_mail", mail);
    say(`T'hem enviat un enllaç a ${mail}. Obre'l en aquest mòbil. Pot trigar uns minuts: mira també el correu brossa.`); }
  catch(e){ say(errText(e), true); }
}
async function handleLink(){
  if(!A.isSignInWithEmailLink(auth, location.href)) return;
  let mail = store.get("cem_link_mail");
  if(!mail){ mail = (prompt("Per acabar d'entrar, escriu el correu on has rebut l'enllaç:") || "").trim().toLowerCase(); if(!mailOk(mail)) return; }
  try{ await A.signInWithEmailLink(auth, mail, location.href); store.set("cem_link_mail", null); }
  catch(e){ setTimeout(() => { openPanel("pCompte"); say(errText(e), true); }, 300); }
  finally{ history.replaceState(null, "", location.pathname); }
}
async function resendVerify(){
  try{ await A.sendEmailVerification(user, {url: linkUrl()}); say(`T'hem tornat a enviar el correu de confirmació a ${user.email}.`); }catch(e){ say(errText(e), true); }
}
async function checkVerify(){
  try{ await user.reload(); await user.getIdToken(true); user = auth.currentUser; await readProfile(); render(); badges();
    say(verified() ? "Correu confirmat. Ja pots proposar parets." : "Encara no consta confirmat. Obre l'enllaç del correu i torna-ho a provar.", !verified()); }
  catch(e){ say(errText(e), true); }
}
async function logout(){ try{ await A.signOut(auth); say("Has tancat la sessió. Les parets d'aquest mòbil s'hi queden."); }catch(e){ say(errText(e), true); } }
async function saveName(){
  const nom = val("accDNom").replace(/\s+/g, " ").slice(0, 80);
  if(!nom){ say("Escriu el teu nom.", true); return; }
  try{ const f = await fs(); await T(f.updateDoc(f.doc(db, "usuaris", user.uid), {nom})); prof.nom = nom; say("Nom desat."); render(); }catch(e){ say(errText(e), true); }
}
async function makeProfile(){
  if(!$("accConsent") || !$("accConsent").checked){ say("Cal marcar la casella d'acceptació.", true); return; }
  try{ await createProfile(val("accName")); await refreshMine(); say("Perfil creat."); render(); badges(); }catch(e){ say(errText(e), true); }
}
// Esborrar el compte: perfil, propostes (també les aprovades, que porten qui les va enviar) i accés.
// Les parets aprovades queden al catàleg sense cap dada personal (llicència ODbL acceptada en proposar-les).
async function deleteAccount(){
  say("Esborrant…");
  try{
    if(Date.now() - Date.parse(user.metadata.lastSignInTime) > 4 * 60e3){ say("Per seguretat, tanca la sessió, torna a entrar i esborra el compte de seguida.", true); return; }
    const f = await fs();
    const qs = await f.getDocs(f.query(f.collection(db, "propostes"), f.where("userId", "==", user.uid)));
    for(const d of qs.docs) await f.deleteDoc(d.ref);
    await f.deleteDoc(f.doc(db, "usuaris", user.uid)).catch(() => {});
    await A.deleteUser(user);
    userWalls.forEach(w => { delete w.prop; }); saveWalls();
    store.set("cem_had", 0); store.set("cem_consent", null); mode = "alta";
    say("Compte esborrat. Les parets d'aquest mòbil s'hi queden; les aprovades continuen al catàleg sense el teu nom.");
  }catch(e){ say(errText(e), true); render(); }
}

/* ---------- proposar una paret ---------- */
function propose(id){
  const w = userWalls.find(w => w.id === id); if(!w) return;
  if(!user){ mode = store.get("cem_had") ? "entra" : "alta"; openPanel("pCompte"); load().catch(() => {}); setTimeout(() => say("Per proposar parets cal un compte. Entra o fes-te'n un: és gratuït.", false), 50); return; }
  if(!verified()){ openPanel("pCompte"); setTimeout(() => say("Abans de proposar, confirma el correu: obre l'enllaç que t'hem enviat i prem «Ja l'he confirmat».", true), 50); return; }
  if(w.segs.some((s, i) => segAz(w, i) == null)){ msg("Fixa l'orientació de tots els trams abans de proposar la paret.", true); setTimeout(() => msg(null), 5000); return; }
  licWall = w; const z = ZONES.find(z => z.id === w.zone);
  $("licWall").innerHTML = `<b>${esc(w.name)}</b> · ${esc(z ? z.name : "")} · ${w.segs.length} tram${w.segs.length > 1 ? "s" : ""} · ${w.exp === "arrecerat" ? "arrecerada" : "exposada"}`;
  $("licCk").checked = !!(prof && prof.odblAt);
  openPanel("pLlicencia"); say("");
}
async function sendProposal(){
  const w = licWall; if(!w) return;
  if(!$("licCk").checked){ say("Per enviar la proposta cal acceptar la llicència.", true); return; }
  say("Enviant la proposta…");
  try{
    const f = await fs();
    // La proposta porta l'orientació final de cada tram (amb la correcció manual, si n'hi ha)
    const segs = w.segs.map((s, i) => ({azAuto: s.azAuto, az: segAz(w, i), hz: s.hz}));
    const ref = await T(f.addDoc(f.collection(db, "propostes"), {userId:user.uid, tipus:"paret", zone:w.zone, name:String(w.name).slice(0, 80),
      exp:w.exp === "arrecerat" ? "arrecerat" : "exposat", d:JSON.stringify({pts:w.pts, segs}), estat:"pendent", llicencia:LIC,
      licAt:f.serverTimestamp(), creat:f.serverTimestamp()}));
    if(!prof.odblAt){ await f.updateDoc(f.doc(db, "usuaris", user.uid), {odblAt:f.serverTimestamp()}).catch(() => {}); prof.odblAt = true; }
    w.prop = {id: ref.id, estat:"pendent"}; saveWalls(); renderAll();
    $("pLlicencia").hidden = true; licWall = null;
    msg("Proposta enviada. Quan la revisin, la veurà tothom."); setTimeout(() => msg(null), 5000);
    if(isRev) refreshPending();
  }catch(e){ say(errText(e), true); }
}
// Estat de les meves propostes (des de qualsevol mòbil): actualitza les parets d'aquest mòbil
async function refreshMine(){
  if(!user || !prof) return;
  const f = await fs();
  const qs = await T(f.getDocs(f.query(f.collection(db, "propostes"), f.where("userId", "==", user.uid))));
  const byId = {}; qs.forEach(d => byId[d.id] = d.data());
  let ch = false;
  userWalls.forEach(w => { if(!w.prop) return; const p = byId[w.prop.id];
    if(!p){ delete w.prop; ch = true; return; }
    if(p.estat !== w.prop.estat || (p.motiu || "") !== (w.prop.motiu || "")){ w.prop = {id:w.prop.id, estat:p.estat, motiu:p.motiu || ""}; ch = true; } });
  if(ch) saveWalls();
  if(Object.values(byId).some(p => p.estat === "aprovada")) fetchPublic(true);
  renderAll();
}

/* ---------- revisió (administració, revisors i premium) ---------- */
async function refreshPending(){
  if(!isRev) return;
  try{
    const f = await fs();
    const qs = await T(f.getDocs(f.query(f.collection(db, "propostes"), f.where("estat", "==", "pendent"))));
    pending = qs.docs.map(d => ({id:d.id, ...d.data()})).sort((a, b) => (a.creat?.seconds || 0) - (b.creat?.seconds || 0));
    for(const p of pending) if(!(p.userId in authors)){
      authors[p.userId] = await f.getDoc(f.doc(db, "usuaris", p.userId)).then(d => d.exists() ? d.data().nom : "(compte esborrat)", () => "?");
    }
  }catch(e){ say(errText(e), true); }
  badges(); renderRev();
}
function renderRev(){
  const box = $("revBox"); if(!box) return;
  if(!isRev){ box.innerHTML = `<p class="note">Només per a l'administració, revisors i premium.</p>`; return; }
  box.innerHTML = `<div class="amsg" data-accmsg hidden></div>` + (pending.length ? pending.map(p => {
    const z = ZONES.find(z => z.id === p.zone); let d = {}; try{ d = JSON.parse(p.d); }catch(e){}
    const azs = (d.segs || []).map(s => s.az == null ? "?" : cardOf(s.az)).join(", ");
    const when = p.creat ? new Date(p.creat.seconds * 1000).toLocaleDateString("ca") : "";
    return `<div class="rv"><div><b>${esc(p.name)}</b> · ${esc(z ? z.name : p.zone)}</div>` +
      `<div class="note">${(d.segs || []).length} tram${(d.segs || []).length > 1 ? "s" : ""} · mira al ${azs} · ${p.exp === "arrecerat" ? "arrecerada" : "exposada"} · ${esc(authors[p.userId] || "")} · ${when}</div>` +
      (rejecting === p.id ? `<div class="acc"><label>Motiu (el veurà qui l'ha proposada)<textarea id="rvMotiu" maxlength="200"></textarea></label>` +
        `<div class="row"><button class="btn" type="button" data-rv="cancel">Cancel·la</button><button class="btn pri" type="button" data-rv="reject2" data-id="${p.id}">Rebutja-la</button></div></div>`
      : `<div class="row"><button class="btn" type="button" data-rv="show" data-id="${p.id}">Al mapa</button>` +
        `<button class="btn" type="button" data-rv="reject" data-id="${p.id}">Rebutja</button><button class="btn pri" type="button" data-rv="approve" data-id="${p.id}">Aprova</button></div>`) + `</div>`;
  }).join("") : `<p class="note">No hi ha cap proposta pendent.</p>`);
}
async function approve(id){
  const p = pending.find(p => p.id === id); if(!p) return;
  try{
    const f = await fs(), b = f.writeBatch(db);
    let d = {}; try{ d = JSON.parse(p.d); }catch(e){}
    // A la paret publicada, l'orientació revisada passa a ser la de fàbrica (azAuto) i no hi ha cap dada personal
    const segs = (d.segs || []).map(s => ({azAuto: s.az ?? s.azAuto, hz: s.hz}));
    b.set(f.doc(db, "parets", id), {zone:p.zone, name:p.name, exp:p.exp, d:JSON.stringify({pts:d.pts, segs}), llicencia:LIC, v:1, aprovat:f.serverTimestamp()});
    b.update(f.doc(db, "propostes", id), {estat:"aprovada", revisatPer:user.uid, revisatAt:f.serverTimestamp()});
    await T(b.commit());
    say("Aprovada: ja la veu tothom."); await refreshPending(); fetchPublic(true); refreshMine();
  }catch(e){ say(errText(e), true); }
}
async function reject(id){
  const motiu = val("rvMotiu").slice(0, 200);
  if(!motiu){ say("Escriu el motiu: ajuda a qui l'ha proposada a corregir-la.", true); return; }
  try{ const f = await fs(); await T(f.updateDoc(f.doc(db, "propostes", id), {estat:"rebutjada", motiu, revisatPer:user.uid, revisatAt:f.serverTimestamp()}));
    rejecting = null; say("Rebutjada."); await refreshPending(); refreshMine(); }
  catch(e){ say(errText(e), true); }
}
// Mostra una proposta al mapa amb la capa de traçat (groc discontinu)
function showOnMap(id){
  const p = pending.find(p => p.id === id); if(!p) return;
  let d = {}; try{ d = JSON.parse(p.d); }catch(e){ return; }
  document.querySelectorAll(".panel").forEach(x => x.hidden = true);
  const feats = d.pts.map(c => ({type:"Feature", geometry:{type:"Point", coordinates:c}})).concat([{type:"Feature", geometry:{type:"LineString", coordinates:d.pts}}]);
  map.getSource("draw") && map.getSource("draw").setData({type:"FeatureCollection", features:feats});
  const xs = d.pts.map(c => c[0]), ys = d.pts.map(c => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], {padding:120, maxZoom:17});
  if(base !== "orto"){ base = "orto"; applyBase(); }
  msg(`Proposta «${p.name}» en groc. Torna a ⋮ ▸ Revisió per aprovar-la.`);
  setTimeout(() => { msg(null); if(!drawing && map.getSource("draw")) map.getSource("draw").setData({type:"FeatureCollection", features:[]}); }, 20000);
}

/* ---------- interfície ---------- */
const PRIV_HTML = `
  <p><b>Responsable:</b> projecte CEM · Centre Excursionista del Masnou (contacte: ${OWNER_EMAIL}).</p>
  <p><b>Què es desa:</b> el teu nom, el correu, la data d'aquesta acceptació i les propostes de parets que enviïs.</p>
  <p><b>Qui ho veu:</b> el nom i el correu, només l'administració i les persones revisores, per poder revisar les propostes. Les parets aprovades es publiquen sense cap dada teva.</p>
  <p><b>On:</b> Google Firebase (Authentication i Cloud Firestore), en servidors de la Unió Europea.</p>
  <p><b>Per a què:</b> només perquè el compte i les propostes funcionin. No es ven ni es cedeix, i el correu no s'envia a cap altre servei.</p>
  <p><b>Els teus drets:</b> pots corregir el nom i esborrar el compte des d'aquí, quan vulguis. Per a qualsevol altra consulta, escriu al contacte de dalt.</p>
  <p><b>Edat:</b> cal tenir 14 anys o més.</p>`;
const ROL_TXT = () => isAdm ? "Administració" : prof && prof.premium ? "Premium" : prof && prof.rol === "revisor" ? "Revisor" : "Registrat";
function render(){
  const box = $("accBox"); if(!box) return;
  let h = `<div class="amsg${flash.err ? " err" : ""}" data-accmsg${flash.t ? "" : " hidden"}>${esc(flash.t)}</div>`;
  if(!ready && store.get("cem_cloud")){ box.innerHTML = h + `<p class="note">Comprovant la sessió…</p>`; return; }
  if(!user){
    h += `<p class="note">Sense compte pots fer-ho tot excepte proposar parets perquè les vegi tothom.</p>` +
      `<div class="seg" role="group" aria-label="Tipus d'accés" id="accMode"><button type="button" data-m="entra" aria-pressed="${mode === "entra"}">Entra</button>` +
      `<button type="button" data-m="alta" aria-pressed="${mode === "alta"}">Alta nova</button></div>` +
      (mode === "alta" ? `<label>Nom<input type="text" id="accName" autocomplete="name" maxlength="80"></label>` : "") +
      `<label>Correu<input type="email" id="accMail" autocomplete="email" inputmode="email"></label>` +
      `<label>Contrasenya<input type="password" id="accPass" autocomplete="${mode === "alta" ? "new-password" : "current-password"}"></label>` +
      (mode === "alta" ? `<label>Repeteix la contrasenya<input type="password" id="accPass2" autocomplete="new-password"></label>` +
        `<div class="legal">${PRIV_HTML}</div><label class="ck"><input type="checkbox" id="accConsent"> He llegit la informació de privadesa, hi estic d'acord i tinc 14 anys o més.</label>` +
        `<button class="btn pri" type="button" data-acc="create">Crea el compte</button>`
      : `<button class="btn pri" type="button" data-acc="login">Entra</button><button class="btn" type="button" data-acc="reset">He oblidat la contrasenya</button>`) +
      `<button class="btn" type="button" data-acc="link">${mode === "alta" ? "O bé, crea'l amb un enllaç al correu" : "Entra amb un enllaç al correu"}</button>`;
  }else if(!prof){
    h += `<p>Has entrat com a <b>${esc(user.email)}</b>. Falta crear el perfil.</p><label>Nom<input type="text" id="accName" maxlength="80"></label>` +
      `<div class="legal">${PRIV_HTML}</div><label class="ck"><input type="checkbox" id="accConsent"> He llegit la informació de privadesa, hi estic d'acord i tinc 14 anys o més.</label>` +
      `<button class="btn pri" type="button" data-acc="profile">Crea el perfil</button><button class="btn" type="button" data-acc="logout">Tanca la sessió</button>`;
  }else{
    h += `<p><b>${esc(prof.nom)}</b> · ${esc(user.email)} · ${ROL_TXT()}</p>` +
      (verified() ? "" : `<div class="amsg err">Correu sense confirmar: no pots proposar parets fins que obris l'enllaç que t'hem enviat.</div>` +
        `<div class="row"><button class="btn" type="button" data-acc="resend">Torna a enviar el correu</button><button class="btn pri" type="button" data-acc="check">Ja l'he confirmat</button></div>`) +
      `<label>Nom<input type="text" id="accDNom" value="${esc(prof.nom)}" maxlength="80"></label><button class="btn" type="button" data-acc="name">Desa el nom</button>` +
      `<button class="btn" type="button" data-acc="logout">Tanca la sessió</button>` +
      `<details class="more"><summary>Esborra el compte</summary><p class="note">S'esborren el perfil, les propostes i l'accés. Les parets aprovades queden al catàleg sense el teu nom. Les parets d'aquest mòbil s'hi queden.</p><div id="accDel"></div></details>`;
  }
  box.innerHTML = h;
  const del = $("accDel"); if(del) slideConfirm(del, "Llisca per esborrar el compte", deleteAccount);
}
function badges(){
  const n = isRev ? pending.length : 0;
  $("rowRev").hidden = !isRev;
  $("revBadge").hidden = !n; $("revBadge").textContent = n;
  const warn = !!(user && (!prof || !verified()));
  $("accBadge").hidden = !warn;
  $("peekAcc").textContent = !user ? "Sense compte: entra per proposar parets" : !prof ? "Falta crear el perfil" : `${prof.nom} · ${ROL_TXT()}${verified() ? "" : " · correu sense confirmar"}`;
  $("peekRev").textContent = n ? n + " proposta" + (n > 1 ? "s" : "") + " per revisar" : "Cap proposta pendent";
  let dot = $("menuBtn").querySelector(".dot-badge");
  if(n || warn){ if(!dot){ dot = document.createElement("span"); dot.className = "dot-badge"; $("menuBtn").appendChild(dot); } } else if(dot) dot.remove();
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const m = e.target.closest && e.target.closest("#accMode button[data-m]"); if(m){ mode = m.dataset.m; say(""); render(); return; }
  const b = e.target.closest && e.target.closest("button[data-acc]");
  if(b) ({create:passCreate, login:passLogin, reset:passReset, link:sendLink, logout, resend:resendVerify, check:checkVerify, name:saveName, profile:makeProfile})[b.dataset.acc]();
  const r = e.target.closest && e.target.closest("button[data-rv]");
  if(r){ const id = r.dataset.id;
    if(r.dataset.rv === "approve") approve(id);
    else if(r.dataset.rv === "reject"){ rejecting = id; renderRev(); }
    else if(r.dataset.rv === "reject2") reject(id);
    else if(r.dataset.rv === "cancel"){ rejecting = null; renderRev(); }
    else if(r.dataset.rv === "show") showOnMap(id); }
  const p = e.target.closest && e.target.closest("[data-page]");
  if(p && p.dataset.page === "pCompte"){ render(); if(!loading) load().catch(() => { say("Sense connexió: ara no es pot entrar.", true); }); }
  if(p && p.dataset.page === "pRevisio"){ renderRev(); refreshPending(); }
});
$("licSend").addEventListener("click", sendProposal);

// API per a app.js
// Per a altres mòduls (restr.js): comprova que hi ha compte amb el correu confirmat i torna l'accés a Firestore.
// Si no n'hi ha, obre ⋮ ▸ Compte amb el motiu i torna null.
async function need(why){
  if(!user){ mode = store.get("cem_had") ? "entra" : "alta"; document.querySelectorAll(".panel").forEach(x => x.hidden = true); openPanel("pCompte"); load().catch(() => {});
    setTimeout(() => say(why || "Per fer això cal un compte. Entra o fes-te'n un: és gratuït.", false), 50); return null; }
  if(!verified() || !prof){ document.querySelectorAll(".panel").forEach(x => x.hidden = true); openPanel("pCompte");
    setTimeout(() => say(!prof ? "Falta crear el perfil." : "Abans, confirma el correu: obre l'enllaç que t'hem enviat i prem «Ja l'he confirmat».", true), 50); return null; }
  const f = await fs();
  return {f, db, uid: user.uid, isRev, odbl: !!prof.odblAt,
    markOdbl: async () => { if(prof.odblAt) return; await f.updateDoc(f.doc(db, "usuaris", user.uid), {odblAt: f.serverTimestamp()}).catch(() => {}); prof.odblAt = true; }};
}
window.CEM_CLOUD = {propose, need, uid: () => user ? user.uid : null, isRev: () => isRev, errText,
  refresh: () => { fetchPublic(true); if(user) refreshMine(); }};

/* ---------- inici ---------- */
fetchPublic();
if(store.get("cem_cloud") || /[?&](oobCode|mode)=/.test(location.search)) load().catch(() => { ready = true; render(); });
else { ready = true; }
render(); badges();
document.addEventListener("visibilitychange", () => { if(!document.hidden){ fetchPublic(); if(user && Date.now() - (window.__cemMine || 0) > 600e3){ window.__cemMine = Date.now(); refreshMine().catch(() => {}); if(isRev) refreshPending(); } } });
})();
