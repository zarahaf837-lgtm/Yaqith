/*!
 * Yaqith (يقظ) — interface script: rendering, interactions, audit log, persistence, i18n.
 * Depends on js/data/occupations.js, js/engine.js and js/vendor/qrcode.min.js.
 */
(function(){
"use strict";
var LANG="ar";
function L(ar,en){return LANG==="ar"?ar:en}
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}

/* ---------- engine (js/engine.js) ---------- */
var YE=window.YaqithEngine, EDU=YE.EDU, GROUPS=YE.GROUPS, OCC=YE.OCC, norm=YE.norm, matchOcc=YE.matchOcc;
var RULE_TXT={vague:["مؤهل غامض: يُفسَّر بأدنى تفسير ممكن","Vague qualification: lowest possible interpretation"],or:["صيغة (X أو Y): يُقارن الأدنى منهما","\"X or Y\": the lower one is compared"],min:["صيغة (X فأعلى): الحد الأدنى هو X","\"X or higher\": the minimum is X"],direct:["مطابقة مباشرة مع جدول المرادفات","Direct match with the synonyms table"]};

/* ---------- samples ---------- */
var SAMPLES=[
 {k:"ok",ar:"أخصائي تسويق",en:"Marketing specialist",text:"المسمى الوظيفي: أخصائي تسويق\nالمؤهل: بكالوريوس فأعلى\nالخبرة: سنتان\nالمنشأة: شركة تقنية المستقبل"},
 {k:"no",ar:"كاشير بمؤهل بكالوريوس",en:"Cashier requiring a bachelor",text:"المسمى الوظيفي: كاشير\nالمؤهل: بكالوريوس\nالخبرة: لا يشترط\nالمنشأة: شركة تقنية المستقبل"},
 {k:"rv",ar:"أمين صندوق بمؤهل عالٍ",en:"Treasurer, vague qualification",text:"المسمى الوظيفي: أمين صندوق\nالمؤهل: مؤهل عالي\nالخبرة: 3 سنوات\nالمنشأة: شركة تقنية المستقبل"},
 {k:"ok2",ar:"موظف استقبال بثانوية أو دبلوم",en:"Receptionist, secondary or diploma",text:"المسمى الوظيفي: موظف استقبال\nالمؤهل: ثانوية عامة أو دبلوم\nالخبرة: سنة\nالمنشأة: شركة تقنية المستقبل"}];
var current=0;

var STEPS=[
 ["إدخال الإعلان","Enter ad"],["استخراج البيانات","Extract data"],["رمز المهنة","Occupation code"],["سقف المؤهل","Qualification cap"],
 ["مراجعة بشرية","Human review"],["القرار والسبب","Decision & reason"],["توليد الباركود","Barcode"],["النشر والاستقطاب","Publish & recruit"],
 ["محضر المقابلة","Interview minutes"],["إغلاق الشاغر","Close vacancy"],["سجل التدقيق","Audit log"]];
function drawRail(state){
  var r=$("rail");r.innerHTML="";
  STEPS.forEach(function(s,i){
    var li=document.createElement("li");var st=state[i]||"";
    if(st)li.className=st;
    li.innerHTML="<i>"+(i+1)+"</i>"+esc(L(s[0],s[1]));r.appendChild(li);
  });
}

function drawSamples(){
  var box=$("samples");box.innerHTML="";
  SAMPLES.forEach(function(s,i){
    var b=document.createElement("button");b.type="button";b.textContent=L(s.ar,s.en);
    if(i===current)b.className="on";
    b.onclick=function(){current=i;$("adText").value=s.text;extract();drawSamples();run()};
    box.appendChild(b);
  });
}
function extract(){
  var t=$("adText").value, get=function(re){var m=t.match(re);return m?m[1].trim():""};
  $("fTitle").value=get(/(?:المسمى(?: الوظيفي)?|Job title)\s*[:：]\s*(.+)/)||t.split("\n")[0].trim();
  $("fQual").value=get(/(?:المؤهل(?: المطلوب)?|Qualification)\s*[:：]\s*(.+)/);
  $("fExp").value=get(/(?:الخبرة|Experience)\s*[:：]\s*(.+)/);
}

/* ---------- audit log ---------- */
var LOG=[];
function stamp(){var d=new Date();return d.toISOString().slice(0,19).replace("T"," ")}
function audit(evt,ar,en,cls){LOG.push({t:stamp(),e:evt,ar:ar,en:en,c:cls||""});drawLog();if(typeof save==="function")setTimeout(save,0)}
function drawLog(){
  var el=$("log");el.innerHTML="";
  LOG.slice().reverse().forEach(function(x){
    var d=document.createElement("div");
    d.innerHTML='<span class="t">'+x.t+'</span><span class="e '+x.c+'">'+x.e+'</span><span class="d">'+esc(L(x.ar,x.en))+'</span>';
    el.appendChild(d);
  });
}

/* ---------- decision engine ---------- */
var lastAccepted=null, seq=417;
function token(){var c="abcdefghjkmnpqrstuvwxyz23456789",s="";var a=new Uint32Array(16);(window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.random()*4e9;return x}}).getRandomValues(a);for(var i=0;i<16;i++)s+=c[a[i]%c.length];return s}
function fmtDate(d){return d.toISOString().slice(0,10)}
function run(silent){
  var title=$("fTitle").value.trim(), qual=$("fQual").value.trim(), exp=$("fExp").value.trim();
  var adId=(silent&&run.lastId)?run.lastId:"YQZ-AD-"+new Date().getFullYear()+"-"+String(++seq).padStart(4,"0");run.lastId=adId;
  var rail=["done","done","done","","","","","","skip","",""];
  var out=[];
  out.push('<div class="card"><div class="row-k"><span>'+L("رقم الإعلان","Ad ID")+'</span><span class="mono">'+adId+'</span></div>'+
    '<div class="row-k"><span>'+L("المسمى","Title")+'</span><b>'+esc(title||"—")+'</b></div>'+
    '<div class="row-k"><span>'+L("المؤهل المطلوب","Required qualification")+'</span><b>'+esc(qual||"—")+'</b></div>'+
    '<div class="row-k"><span>'+L("الخبرة","Experience")+'</span><span>'+esc(exp||"—")+' <span class="tag t-navy">'+L("تنبيه فقط","Notice only")+'</span></span></div></div>');
  var A=YE.assess(title,qual), m=A.m, top=A.top;
  var matchHtml='<div class="card"><div class="f" style="font-weight:600;margin-bottom:10px">'+L("٣ · أقرب 3 مهن مع درجة الثقة","3 · Top 3 occupations with confidence")+'</div><div class="match">';
  m.forEach(function(x){matchHtml+='<div class="m"><span class="mono">'+x.o.code+'</span><span>'+esc(L(x.o.ar,x.o.en))+'</span><span class="cbar"><span class="bar-t" style="width:70px"><b style="width:'+x.s+'%"></b></span><span class="num">'+x.s+'%</span></span></div>'});
  matchHtml+='</div></div>';
  out.push(matchHtml);
  var q=A.q, g=A.g, cap=A.cap;
  if(q)q.rule=L(RULE_TXT[q.ruleKey][0],RULE_TXT[q.ruleKey][1]);
  if(q&&cap!==null){
    var lv='<div class="levels">';
    EDU.forEach(function(e){var cls=[];if(e.lv<=cap)cls.push("cap");if(e.lv>cap&&e.lv<=q.lv)cls.push("over");if(e.lv===q.lv)cls.push("req");lv+='<div class="'+cls.join(" ")+'" title="'+esc(L(e.ar,e.en))+'">'+e.lv+'</div>'});
    lv+='</div><div class="lv-legend"><span><i style="background:var(--tint-green)"></i>'+L("ضمن السقف","Within cap")+'</span><span><i style="background:var(--crit-bg)"></i>'+L("فوق السقف","Above cap")+'</span><span><i style="outline:2px solid var(--navy)"></i>'+L("المطلوب في الإعلان","Required by ad")+'</span></div>';
    out.push('<div class="card"><div class="f" style="font-weight:600;margin-bottom:6px">'+L("٤ · سقف المؤهل","4 · Qualification cap")+'</div>'+
      '<div class="row-k"><span>'+L("المجموعة (أول خانة من الرمز)","Group (first digit of code)")+'</span><span><span class="mono">'+top.o.code.charAt(0)+'</span> · '+esc(L(g.ar,g.en))+'</span></div>'+
      '<div class="row-k"><span>'+L("مستوى المهارة","Skill level")+'</span><span class="num">'+g.skill+'</span></div>'+
      '<div class="row-k"><span>'+L("السقف","Cap")+'</span><span><b class="num">'+cap+'</b> · '+esc(L(EDU[cap].ar,EDU[cap].en))+(g.temp?' <span class="tag t-warn">'+L("مؤقت","Temporary")+'</span>':'')+'</span></div>'+
      '<div class="row-k"><span>'+L("مستوى المؤهل المطلوب","Required level")+'</span><span><b class="num">'+q.lv+'</b> · '+esc(L(EDU[q.lv].ar,EDU[q.lv].en))+'</span></div>'+
      '<div class="row-k"><span>'+L("القاعدة المطبّقة","Rule applied")+'</span><span>'+esc(q.rule)+'</span></div>'+lv+'</div>');
  }
  rail[3]=(cap!==null&&q)?"done":"";
  var flags=A.flags;
  var conf=top?top.s:0, ctx={adId:adId,title:title,top:top,q:q,qual:qual,cap:cap};
  run.ctx=ctx;
  if(!flags.length){
    out.push('<div class="verdict ok"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex:none"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg><div><h3>'+L("٦ · اعتماد تلقائي · 0% Risk","6 · Auto-approved · 0% Risk")+'</h3><p>'+esc(L("لا يوجد أي مؤشر خطر: المؤهل المطلوب ("+EDU[q.lv].ar+") ضمن سقف مهنة "+top.o.ar+" ("+EDU[cap].ar+")، فيمر الإعلان دون تعطيل المراجع البشري.","No risk indicator: the required qualification ("+EDU[q.lv].en+") is within the cap for "+top.o.en+" ("+EDU[cap].en+"), so the ad passes without a human reviewer."))+'</p><p class="note mono" style="margin-top:6px;direction:ltr;text-align:start">RISK 0% → AUTO_APPROVE · confidence '+conf+'%</p></div></div>');
    out.push('<div id="bcBox"></div>');
    rail[4]="skip";rail[5]="done";rail[6]="done";rail[10]="done";
    $("result").innerHTML=out.join("");
    issueBarcode(ctx,silent);
    drawRail(rail);
    if(!silent)audit("AD_AUTO_APPROVED",adId+" · "+top.o.code+" · RISK 0%",adId+" · "+top.o.code+" · RISK 0%");
    return;
  }
  var rec=flags.some(function(f){return f.rec==="reject"})?"reject":"review";
  var lines=$("adText").value.split("\n").map(function(ln){
    var hit=(/المسمى|Job title/.test(ln)&&flags.some(function(f){return f.f==="title"}))||(/المؤهل|Qualification/.test(ln)&&flags.some(function(f){return f.f==="qual"}));
    return hit?'<mark class="hl">'+esc(ln)+'</mark>':esc(ln);
  }).join("<br>");
  out.push('<div class="verdict rv"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex:none"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><div><h3>'+L("٥ · إحالة فورية للمراجع البشري","5 · Referred to a human reviewer")+'</h3><p>'+esc(L("رُصد "+flags.length+" مؤشر خطر، والاعتماد التلقائي مخصص لصفرية المخاطر فقط. القرار النهائي بشري.","Detected "+flags.length+" risk indicator(s); auto-approval is only for 0% risk. The final decision is human."))+'</p><p class="note mono" style="margin-top:6px;direction:ltr;text-align:start">'+flags.map(function(f){return f.rule}).join(" · ")+' → REVIEW · confidence '+conf+'%</p></div></div>');
  out.push('<div class="card review" id="revCard"><div class="rev-head"><span class="tag t-navy">'+L("لوحة المراجع / المفتش","Reviewer / inspector dashboard")+'</span><span class="mono note">'+adId+'</span></div>'+
    '<div class="f" style="font-weight:600;margin:10px 0 6px">'+L("الفقرة المشبوهة","Flagged passage")+'</div><div class="adview">'+lines+'</div>'+
    '<ul class="flags">'+flags.map(function(f){return '<li>'+esc(L(f.ar,f.en))+'</li>'}).join("")+'</ul>'+
    '<div class="recbox '+(rec==="reject"?"r":"v")+'"><b>'+L("التوصية المقترحة: ","Suggested recommendation: ")+(rec==="reject"?L("رفض وإعادة للمنشأة مع السبب","Reject and return to the establishment with the reason"):L("تحقق يدوي ثم قرار","Manual check, then decide"))+'</b></div>'+
    '<label class="f" for="revNote" style="margin-top:12px"><span>'+L("ملاحظة المراجع (إجبارية)","Reviewer note (required)")+'</span><input type="text" id="revNote" placeholder="'+L("سبب القرار…","Reason for the decision…")+'"></label>'+
    '<div class="acts" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px"><button class="btn pri sm" type="button" id="revOk">'+L("اعتماد الإعلان","Approve the ad")+'</button><button class="btn sec sm" type="button" id="revNo">'+L("رفض وإعادة للمنشأة","Reject and return")+'</button></div>'+
    '<div id="revOut"></div></div>');
  out.push('<div id="bcBox"></div>');
  rail[4]="done";rail[6]="";rail[10]="done";
  $("result").innerHTML=out.join("");
  drawRail(rail);run.rail=rail;
  $("revOk").onclick=function(){reviewDecide(true)};
  $("revNo").onclick=function(){reviewDecide(false)};
  if(!silent)audit("AD_REFERRED",adId+" · "+flags.map(function(f){return f.rule}).join(" · ")+" → REVIEW",adId+" · "+flags.map(function(f){return f.rule}).join(" · ")+" → REVIEW","rv");
}
function reviewDecide(ok){
  var n=$("revNote").value.trim(), c=run.ctx;
  if(!n){$("revNote").focus();toast(L("اكتب ملاحظة المراجع أولًا، فهي إجبارية.","Write the reviewer note first; it is required."));return}
  $("revOk").disabled=true;$("revNo").disabled=true;
  var r=run.rail||[];r[5]="done";
  if(ok){
    $("revOut").innerHTML='<div class="verdict ok" style="margin-top:12px"><div><h3>'+L("٦ · اعتُمد بقرار المراجع","6 · Approved by the reviewer")+'</h3><p>'+esc(n)+'</p></div></div>';
    r[6]="done";issueBarcode(c,false);
    audit("AD_APPROVED_BY_REVIEWER",c.adId+" · ملاحظة: "+n,c.adId+" · note: "+n);
  } else {
    $("revOut").innerHTML='<div class="verdict no" style="margin-top:12px"><div><h3>'+L("٦ · رُفض بقرار المراجع وأُعيد للمنشأة","6 · Rejected by the reviewer and returned")+'</h3><p>'+esc(n)+'</p></div></div>';
    r[6]="skip";
    audit("AD_REJECTED_BY_REVIEWER",c.adId+" · السبب: "+n,c.adId+" · reason: "+n,"bad");
  }
  drawRail(r);
}
function issueBarcode(c,silent){
  var start=new Date(), end=new Date(Date.now()+30*864e5), tk=(silent&&lastAccepted&&lastAccepted.id===c.adId)?lastAccepted.tk:token();
  var lv=c.q?c.q.lv:(c.cap!==null?c.cap:3);
  lastAccepted={id:c.adId,title:c.title,code:c.top.o.code,occ:c.top.o,qual:c.qual,lv:lv,start:fmtDate(start),end:fmtDate(end),tk:tk};
  $("bcBox").innerHTML='<div class="card"><div class="f" style="font-weight:600;margin-bottom:10px">'+L("٧ · باركود الشاغر","7 · Vacancy barcode")+'</div><div class="qrbox"><div class="qr" id="qr"></div><div style="display:grid;gap:4px;font-size:14.5px;min-width:0"><span>'+L("رمز تعريف عشوائي لا يمكن تخمينه، ولا يحمل نص الإعلان","A random, unguessable token that does not carry the ad text")+'</span><span class="mono" style="word-break:break-all">/verify/'+tk+'</span><span>'+L("الفترة: ","Period: ")+'<span dir="ltr" class="mono" style="white-space:nowrap">'+fmtDate(start)+' → '+fmtDate(end)+'</span></span><a href="#verify" class="btn sec sm" style="justify-self:start">'+L("افتح صفحة التحقق","Open verification page")+'</a></div></div></div>';
  try{new QRCode($("qr"),{text:"YAQITH-VERIFY:"+tk,width:224,height:224,colorDark:"#25405E",colorLight:"#ffffff"})}catch(e){$("qr").textContent="QR"}
  vstate="valid";drawVerify();
}

/* ---------- verification phone ---------- */
var vstate="valid";
var VSTATES=[
 {k:"valid",ar:"ساري وموثوق",en:"Valid"},{k:"expired",ar:"منتهٍ",en:"Expired"},{k:"closed",ar:"مغلق",en:"Closed"},
 {k:"forged",ar:"مزور / غير مطابق",en:"Forged / no match"},{k:"review",ar:"اشتباه نسخ",en:"Suspected copy"}];
function defAd(){return lastAccepted||{id:"YQZ-AD-2026-0417",title:"أخصائي تسويق",code:"243110",occ:OCC[0],qual:"بكالوريوس فأعلى",lv:6,start:fmtDate(new Date()),end:fmtDate(new Date(Date.now()+30*864e5)),tk:"7f3k9q2xw8mpa4ce"}}
function drawStates(){
  var b=$("states");b.innerHTML="";
  VSTATES.forEach(function(s){var x=document.createElement("button");x.type="button";x.textContent=L(s.ar,s.en);if(s.k===vstate)x.className="on";
    x.onclick=function(){vstate=s.k;drawVerify();var a=defAd();
      if(s.k==="valid")audit("VERIFY_SCAN",a.id+" · ساري",a.id+" · valid");
      if(s.k==="expired"||s.k==="closed")audit("VERIFY_SCAN",a.id+" · "+s.ar,a.id+" · "+s.en,"rv");
      if(s.k==="forged")audit("TAMPER_SUSPECT","باركود لا يطابق السجلات الرسمية","Barcode does not match official records","bad");
      if(s.k==="review")audit("SCAN_ANOMALY",a.id+" · كثرة مسحات غريبة على باركود واحد",a.id+" · unusual scan volume on one barcode","bad");
    };b.appendChild(x)});
}
function drawVerify(){
  drawStates();
  var a=defAd(), s=$("screen"), h="";
  h+='<div class="sb"><span>9:41</span><span>5G ▮▮▮</span></div>';
  h+='<div class="url">yaqith/verify/'+(vstate==="forged"?"x9x9x9x9":a.tk)+'</div>';
  h+='<div class="sh"><img src="'+document.querySelector(".brand img.logo-l").src+'" alt=""><b>'+L("يقظ · صفحة التحقق","Yaqith · Verification")+'</b></div>';
  var st={valid:["ok","✓",L("إعلان ساري وموثوق","Valid and trusted ad"),L("الإعلان رسمي ومجاز ولم ينتهِ وقته.","The ad is official, approved and still valid.")],
    expired:["end","⏱",L("الإعلان منتهٍ","Ad expired"),L("انتهت فترة الإعلان ولا يُقبل التقديم عليه.","The ad period has ended.")],
    closed:["end","■",L("الشاغر مغلق","Vacancy closed"),L("أُغلق الشاغر بتعيين موثّق.","The vacancy was closed with a documented hire.")],
    forged:["bad","✕",L("إعلان غير معتمد","Not an approved ad"),L("عذرًا، هذا الإعلان غير معتمد، أو تم إلغاؤه، أو رقم الباركود لا يتطابق مع السجلات الرسمية.","Sorry, this ad is not approved, was cancelled, or the barcode does not match the official records.")],
    review:["rev","!",L("هذا الإعلان قيد المراجعة","This ad is under review"),L("رُصدت مسحات غير معتادة على هذا الباركود.","Unusual scans were detected on this barcode.")]}[vstate];
  h+='<div class="status '+st[0]+'"><span style="font-size:20px;line-height:1">'+st[1]+'</span><div><b>'+st[2]+'</b>'+st[3]+'</div></div>';
  if(vstate!=="forged"){
    h+='<div class="vbody"><div class="match-hint">'+L("طابق هذه البيانات مع الإعلان الذي أمامك","Compare these details with the ad in front of you")+'</div>'+
    '<div class="row-k"><span>'+L("المنشأة","Establishment")+'</span><b>'+L("شركة تقنية المستقبل","Future Technology Co.")+'</b></div>'+
    '<div class="row-k"><span>'+L("السجل التجاري","Commercial reg.")+'</span><span class="mono">10XXXXXXXX</span></div>'+
    '<div class="row-k"><span>'+L("المسمى ورمز المهنة","Title & code")+'</span><span>'+esc(L(a.occ.ar,a.occ.en))+' · <span class="mono">'+a.code+'</span></span></div>'+
    '<div class="row-k"><span>'+L("المؤهل المطلوب","Qualification")+'</span><span>'+esc(L(EDU[a.lv].ar,EDU[a.lv].en))+'</span></div>'+
    '<div class="row-k"><span>'+L("قناة التقديم الرسمية","Official channel")+'</span><span>'+L("عبر جدارات فقط","Via Jadarat only")+'</span></div>'+
    '<div class="row-k"><span>'+L("تاريخ الاعتماد والصلاحية","Approval & validity")+'</span><span dir="ltr" class="mono" style="font-size:11.5px;white-space:nowrap">'+a.start+' → '+a.end+'</span></div>'+
    '<span class="badge">✓ '+L("تم فحص الإعلان في يقظ","Ad checked by Yaqith")+'</span></div>';
  } else {
    h+='<div class="vbody"><p style="color:#5A6B7B;font-size:13px">'+L("سُجّلت هذه المحاولة كـ\"محاولة اشتباه أو تلاعب\" في سجل التدقيق.","This attempt was logged as \"suspected tampering\" in the audit log.")+'</p></div>';
  }
  h+='<div class="warnbox">'+L("لا يُطلب مبلغ مالي مقابل التوظيف، وأي إعلان يطلب مالًا غير موثوق.","No money is requested in exchange for employment; any ad that asks for money is not trustworthy.")+'</div>';
  s.innerHTML=h;
}

/* ---------- geo dashboard ---------- */
var task=null;
var FAC=[
 {id:"f1",ar:"شركة تقنية المستقبل - الفرع الرئيسي",en:"Future Technology Co. – Main branch",emps:[
  {id:"EMP-2026-01",ar:"عبدالله الشمري",en:"Abdullah Al-Shammari",dar:"تقنية المعلومات",den:"Information Technology",tot:40,inz:39},
  {id:"EMP-2026-03",ar:"فهد الدوسري",en:"Fahad Al-Dosari",dar:"الحوكمة والمخاطر",den:"Governance & Risk",tot:38,inz:32}]},
 {id:"f2",ar:"منشأة تجريبية (ب)",en:"Test establishment (B)",emps:[
  {id:"EMP-2026-02",ar:"سارة القحطاني",en:"Sarah Al-Qahtani",dar:"الموارد البشرية",den:"Human Resources",tot:45,inz:45},
  {id:"EMP-2026-04",ar:"ريم المطيري",en:"Reem Al-Mutairi",dar:"الأمن السيبراني",den:"Cybersecurity",tot:44,inz:44},
  {id:"EMP-2026-05",ar:"خالد الخالد",en:"Khaled Al-Khaled",dar:"البنية التحتية",den:"Infrastructure",tot:41,inz:30}]}];
var rateOf=YE.rateOf, vioOf=YE.vioOf, statusOf=YE.statusOf;
var ACT={ok:["🟢 التزام طبيعي - إرسال إشعار تذكير خفيف","🟢 Normal compliance – send a light reminder"],
 warn:["🟡 تحديث النطاق الجغرافي للموقع الحالي / مراجعة الموظف","🟡 Update the geofence for the current site / review the employee"],
 crit:["🔴 انحراف متكرر - إحالة للمراجعة البشرية","🔴 Repeated deviation – refer to human review"]};
var STAT=[["all","جميع الحالات","All statuses"],["ok","ملتزم","Compliant"],["warn","يحتاج مراجعة","Needs review"],["crit","غير ملتزم","Non-compliant"]];
function fillGeoControls(){
  var fs=$("facSel"),cur=fs.value||"f1";fs.innerHTML="";
  FAC.forEach(function(f){var o=document.createElement("option");o.value=f.id;o.textContent=L(f.ar,f.en);fs.appendChild(o)});fs.value=cur;
  var st=$("fStat"),cs=st.value||"all";st.innerHTML="";
  STAT.forEach(function(s){var o=document.createElement("option");o.value=s[0];o.textContent=L(s[1],s[2]);st.appendChild(o)});st.value=cs;
  fillDept();
}
function fillDept(){
  var f=FAC.filter(function(x){return x.id===$("facSel").value})[0]||FAC[0];
  var d=$("fDept"),cd=d.value;d.innerHTML="";
  var o=document.createElement("option");o.value="all";o.textContent=L("الكل","All");d.appendChild(o);
  f.emps.forEach(function(e){var x=document.createElement("option");x.value=e.dar;x.textContent=L(e.dar,e.den);d.appendChild(x)});
  d.value=[].some.call(d.options,function(op){return op.value===cd})?cd:"all";
}
function drawGeo(){
  var f=FAC.filter(function(x){return x.id===$("facSel").value})[0]||FAC[0];
  var n=f.emps.length, avg=n?f.emps.reduce(function(a,e){return a+rateOf(e)},0)/n:0, v=f.emps.reduce(function(a,e){return a+vioOf(e)},0);
  $("kEmp").textContent=String(n).padStart(2,"0");
  $("kRate").textContent=(Math.round(avg*100)/100).toFixed(2)+"%";
  $("kVio").textContent=String(v).padStart(2,"0");
  var dep=$("fDept").value, st=$("fStat").value, q=norm($("fSearch").value).toLowerCase();
  var rows=f.emps.filter(function(e){return (dep==="all"||e.dar===dep)&&(st==="all"||statusOf(rateOf(e))===st)&&(!q||norm(e.ar).indexOf(q)>-1||String(e.en).toLowerCase().indexOf(q)>-1||e.id.toLowerCase().indexOf(q)>-1)});
  var b=$("empBody");b.innerHTML="";
  if(!rows.length){b.innerHTML='<tr><td colspan="8" class="empty">'+L("لا توجد نتائج مطابقة للفلاتر.","No results match the filters.")+'</td></tr>';return}
  rows.forEach(function(e){var rt=rateOf(e),vi=vioOf(e),s=statusOf(rt);var col={ok:"var(--ok)",warn:"var(--warn)",crit:"var(--crit)"}[s];
    var vcls=vi===0?"t-ok":vi<=2?"t-warn":"t-crit";
    var tr=document.createElement("tr");
    tr.innerHTML='<td><span class="tag t-navy mono">'+e.id+'</span></td><td>'+esc(L(e.ar,e.en))+'</td><td>'+esc(L(e.dar,e.den))+'</td><td class="n">'+e.tot+'</td><td class="n">'+e.inz+'</td><td><span class="vio tag '+vcls+'">'+vi+'</span></td><td><span class="cbar"><span class="bar-t"><b style="width:'+rt+'%;background:'+col+'"></b></span><b class="num">'+rt.toFixed(1)+'%</b></span></td><td>'+esc(L(ACT[s][0],ACT[s][1]))+'</td>';
    b.appendChild(tr)});
}

/* ---------- manage facilities & employees ---------- */
function curFac(){return FAC.filter(function(x){return x.id===$("facSel").value})[0]||FAC[0]}
function fillEmpSel(){
  var f=curFac(), sel=$("mEmp"), cv=sel.value; sel.innerHTML="";
  var o=document.createElement("option");o.value="";o.textContent=L("+ موظف جديد","+ New employee");sel.appendChild(o);
  f.emps.forEach(function(e){var x=document.createElement("option");x.value=e.id;x.textContent=e.id+" · "+L(e.ar,e.en);sel.appendChild(x)});
  sel.value=[].some.call(sel.options,function(op){return op.value===cv})?cv:"";loadEmp();
}
function loadEmp(){
  var e=curFac().emps.filter(function(x){return x.id===$("mEmp").value})[0];
  $("mName").value=e?L(e.ar,e.en):"";$("mDept").value=e?L(e.dar,e.den):"";$("mTot").value=e?e.tot:"";$("mInz").value=e?e.inz:"";
  $("mDel").disabled=!e;
}
function nextEmpId(){var mx=0;FAC.forEach(function(f){f.emps.forEach(function(e){var n=parseInt(e.id.split("-").pop(),10);if(n>mx)mx=n})});return "EMP-2026-"+String(mx+1).padStart(2,"0")}
function saveEmp(){
  var name=$("mName").value.trim(), dept=$("mDept").value.trim(), tot=parseInt($("mTot").value,10), inz=parseInt($("mInz").value,10);
  if(!name||!dept){toast(L("اكتب اسم الموظف والقسم.","Enter the employee name and department."));return}
  if(!(tot>0)||isNaN(inz)||inz<0||inz>tot){toast(L("محاولات البصمة يجب أن تكون 1 فأكثر، وداخل النطاق بين 0 وعدد المحاولات.","Attempts must be at least 1, and in-zone between 0 and attempts."));return}
  var f=curFac(), id=$("mEmp").value, e=f.emps.filter(function(x){return x.id===id})[0];
  if(e){e.ar=name;e.en=name;e.dar=dept;e.den=dept;e.tot=tot;e.inz=inz;audit("EMPLOYEE_UPDATED",e.id+" · "+name+" · "+f.ar,e.id+" · "+name)}
  else{e={id:nextEmpId(),ar:name,en:name,dar:dept,den:dept,tot:tot,inz:inz};f.emps.push(e);audit("EMPLOYEE_ADDED",e.id+" · "+name+" · "+f.ar,e.id+" · "+name)}
  fillDept();drawGeo();fillEmpSel();$("mEmp").value=e.id;loadEmp();save();
  toast(L("حُفظ الموظف وتحدّثت المؤشرات.","Employee saved and indicators updated."));
}
function delEmp(){
  var f=curFac(), id=$("mEmp").value; if(!id)return;
  if($("mDel").dataset.armed!=="1"){$("mDel").dataset.armed="1";$("mDel").textContent=L("اضغط مرة أخرى للحذف","Press again to delete");setTimeout(function(){$("mDel").dataset.armed="";$("mDel").textContent=L("حذف الموظف","Delete employee")},3000);return}
  f.emps=f.emps.filter(function(x){return x.id!==id});$("mDel").dataset.armed="";$("mDel").textContent=L("حذف الموظف","Delete employee");
  audit("EMPLOYEE_REMOVED",id+" · "+f.ar,id,"rv");fillDept();drawGeo();fillEmpSel();save();
}
function addFac(){
  var n=$("mFac").value.trim(); if(!n){toast(L("اكتب اسم المنشأة.","Enter the establishment name."));return}
  var f={id:"f"+(Date.now()%1e7),ar:n,en:n,emps:[]};FAC.push(f);$("mFac").value="";
  fillGeoControls();$("facSel").value=f.id;fillDept();drawGeo();fillEmpSel();save();
  audit("FACILITY_ADDED",n,n);toast(L("أُضيفت المنشأة. أضف موظفيها من النموذج.","Establishment added. Add its employees using the form."));
}

/* ---------- persistence (this browser only) ---------- */
var SKEY="yaqith-demo-v2";
function save(){try{localStorage.setItem(SKEY,JSON.stringify({fac:FAC,log:LOG,last:lastAccepted,task:task,seq:seq,lastId:run.lastId,scanN:scanN,ad:$("adText").value,f:[$("fTitle").value,$("fQual").value,$("fExp").value],cur:current}))}catch(e){}}
function load(){try{var d=JSON.parse(localStorage.getItem(SKEY)||"null");if(!d)return false;
  if(d.fac)FAC=d.fac;if(d.log)LOG=d.log;lastAccepted=d.last||null;task=d.task||null;seq=d.seq||seq;run.lastId=d.lastId;scanN=d.scanN||0;current=d.cur||0;
  $("adText").value=d.ad||"";if(d.f){$("fTitle").value=d.f[0];$("fQual").value=d.f[1];$("fExp").value=d.f[2]}
  return true}catch(e){return false}}
function resetDemo(){
  var b=$("resetBtn");
  if(b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent=L("تأكيد؟","Confirm?");setTimeout(function(){b.dataset.armed="";b.textContent="↺"},3000);return}
  try{localStorage.removeItem(SKEY)}catch(e){}
  location.reload();
}

/* ---------- chip scan simulator ---------- */
var SCANS=[{k:"emp",ar:"مسح الموظف للشريحة",en:"Employee scans the chip"},{k:"insp",ar:"مسح المفتش لشريحة المنشأة",en:"Inspector scans the establishment chip"},{k:"replay",ar:"إعادة استخدام رابط منسوخ",en:"Reuse a copied link"},{k:"spoof",ar:"موقع GPS وهمي",en:"Fake GPS location"}];
var lastSun=null, scanN=0, lastScan=null;
function hex(n){var c="0123456789ABCDEF",o="";for(var i=0;i<n;i++)o+=c[Math.floor(Math.random()*16)];return o}
function drawScanBtns(){var b=$("scanBtns");b.innerHTML="";SCANS.forEach(function(x){var e=document.createElement("button");e.type="button";e.className="btn sec sm";e.textContent=L(x.ar,x.en);e.onclick=function(){doScan(x.k)};b.appendChild(e)});drawScanRes()}
function doScan(k){
  scanN++;var id="SCN-"+String(1000+scanN), uid="04"+hex(12), sun;
  if(k==="replay"){sun=lastSun||hex(32)}else{sun=hex(32);lastSun=sun}
  var d=Math.round(8+Math.random()*30);
  lastScan={k:k,id:id,uid:uid,sun:sun,d:d};drawScanRes();
  var A={emp:["SCAN_OK","مسح موظف صالح داخل النطاق","Valid employee scan inside the zone",""],insp:["PREMISES_VERIFIED","المفتش أثبت المقر الفعلي للمنشأة","Inspector verified the establishment premises",""],replay:["SCAN_REJECTED","رابط منسوخ برمز SUN مستخدم سابقًا","Copied link with a reused SUN code","bad"],spoof:["GEO_VIOLATION","موقع GPS لا يطابق الشريحة المقروءة","GPS location does not match the scanned chip","bad"]}[k];
  audit(A[0],id+" · "+A[1],id+" · "+A[2],A[3]);
}
function drawScanRes(){
  var r=$("scanRes"),x=lastScan;
  if(!x){r.className="scanres";r.innerHTML='<p class="note">'+L("اختر عملية مسح لترى كيف يتحقق السيرفر منها، وتُسجَّل كل محاولة في سجل التدقيق.","Pick a scan to see how the server verifies it; every attempt is logged in the audit log.")+'</p>';return}
  var ok=(x.k==="emp"||x.k==="insp");
  var t={emp:[L("حضور موثّق","Presence verified"),L("الرمز جديد والموقع داخل النطاق المعتمد.","New code and the location is inside the approved zone.")],
    insp:[L("وجود فعلي موثّق للمنشأة","Establishment premises verified"),L("طابق السيرفر الشريحة مع موقع المفتش الفعلي على الخريطة (Geofencing API).","The server matched the chip with the inspector's real location on the map (Geofencing API).")],
    replay:[L("رفض فوري","Rejected instantly"),L("رمز SUN استُخدم سابقًا، فالرابط منسوخ ولا يُقبل.","This SUN code was already used, so the link is a copy and is not accepted.")],
    spoof:[L("مخالفة جغرافية","Geographic violation"),L("الإحداثيات المرسلة لا تطابق الشريحة المقروءة، فكُشف تزييف الموقع (GPS Spoofing).","The submitted coordinates do not match the scanned chip, so location spoofing was detected.")]}[x.k];
  r.className="scanres "+(ok?"ok":"bad");
  r.innerHTML='<h3>'+t[0]+'</h3><p>'+t[1]+'</p><div class="row-k"><span>Scan_ID</span><span class="mono">'+x.id+'</span></div><div class="row-k"><span>Tag_UID</span><span class="mono">'+x.uid+'</span></div><div class="row-k"><span>Dynamic_SUN_Token</span><span class="mono" dir="ltr">'+x.sun+'</span></div><div class="row-k"><span>Is_Valid_Geofence</span><span class="mono">'+(x.k==="spoof"||x.k==="replay"?"false":"true")+'</span></div>';
}

/* ---------- prediction ---------- */
function runAI(){
  var sp=$("spin"),out=$("aiOut"),bar=$("scoreBar"),pb=$("predBox");
  sp.className="spin";$("engStat").textContent=L("جارٍ جمع سجلات 12 شهرًا ومطابقة الأنماط…","Collecting 12 months of records and matching patterns…");
  out.style.opacity=".35";pb.style.opacity=".35";bar.style.width="0%";
  audit("AI_ANALYSIS","بدء تحليل السلوك التراكمي للمنشأة (12 شهرًا)","Started cumulative behavior analysis (12 months)");
  setTimeout(function(){sp.className="spin stop";$("engStat").textContent=L("اكتمل التحليل","Analysis complete");out.style.opacity="1";pb.style.opacity="1";bar.style.width="62%";
    audit("RISK_PREDICTION","مؤشر الالتزام 62% · احتمال مخالفة 78% للشاغر #VAC-4091","Compliance 62% · 78% violation risk for #VAC-4091","rv")},1800);
}

/* ---------- results chart ---------- */
function drawChart(){
  var d=[["دقة الامتثال","Compliance accuracy",92],["العمل عن بُعد","Remote rate",25],["كفاءة الميدان","Field efficiency",38],["امتثال الإعلانات","Ad compliance",63]];
  var h='<div class="f" style="font-weight:600">'+L("كفاءة الامتثال ومعدل الاكتشاف (%)","Compliance efficiency & detection rate (%)")+'</div>';
  d.forEach(function(x){h+='<div class="r"><span>'+L(x[0],x[1])+'</span><span class="bar-t"><b style="width:'+x[2]+'%"></b></span><b class="num">'+x[2]+'%</b></div>'});
  $("chart").innerHTML=h;
}

/* ---------- toast ---------- */
var tt;function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(tt);tt=setTimeout(function(){t.classList.remove("show")},2600)}

/* ---------- i18n ---------- */
function applyLang(){
  var root=document.documentElement;root.lang=LANG;root.dir=LANG==="ar"?"rtl":"ltr";
  document.querySelectorAll("[data-en],[data-en-html]").forEach(function(el){
    if(el.dataset.ar===undefined)el.dataset.ar=el.innerHTML;
    if(LANG==="en"){ if(el.dataset.enHtml!==undefined)el.innerHTML=el.dataset.enHtml; else el.textContent=el.dataset.en; }
    else el.innerHTML=el.dataset.ar;
  });
  document.querySelectorAll("[data-en-ph]").forEach(function(el){if(!el.dataset.arPh)el.dataset.arPh=el.placeholder;el.placeholder=LANG==="en"?el.dataset.enPh:el.dataset.arPh});
  $("langBtn").textContent=LANG==="ar"?"English":"العربية";
  drawSamples();drawRail(lastRail);fillGeoControls();drawGeo();fillEmpSel();drawVerify();drawLog();drawScanBtns();drawTask();
  if($("result").innerHTML)run(true);
}
var lastRail=[];
$("langBtn").onclick=function(){LANG=LANG==="ar"?"en":"ar";try{localStorage.setItem("yq-lang",LANG)}catch(e){}applyLang()};
$("themeBtn").onclick=function(){var r=document.documentElement,cur=r.getAttribute("data-theme");var dark=cur?cur==="dark":matchMedia("(prefers-color-scheme: dark)").matches;r.setAttribute("data-theme",dark?"light":"dark")};
$("extractBtn").onclick=function(){extract();toast(L("تم استخراج البيانات، ويمكنك تعديل أي حقل.","Data extracted; you can edit any field."))};
$("checkBtn").onclick=function(){run()};
$("facSel").onchange=function(){fillDept();drawGeo();fillEmpSel()};
$("mEmp").onchange=loadEmp;$("mSave").onclick=saveEmp;$("mDel").onclick=delEmp;$("mAddFac").onclick=addFac;$("resetBtn").onclick=resetDemo;
$("fDept").onchange=drawGeo;$("fStat").onchange=drawGeo;$("fSearch").oninput=drawGeo;
$("runAI").onclick=runAI;
function drawTask(){if(!task){$("taskBox").innerHTML="";return}
  $("taskBox").innerHTML='<div class="task"><div class="rev-head"><span class="tag t-navy">'+L("تطبيق التفتيش الميداني · مهمة موجهة آليًا","Field inspector app · auto-targeted task")+'</span><span class="tag t-warn">'+L("بانتظار الزيارة","Awaiting visit")+'</span></div>'+
  '<div class="row-k"><span>Task_ID</span><span class="mono">'+task.id+'</span></div><div class="row-k"><span>Inspector_ID</span><span class="mono">INS-DEMO-01</span></div><div class="row-k"><span>Target_Location</span><span>'+L("المنشأة محل التنبيه · الشاغر #VAC-4091","Flagged establishment · vacancy #VAC-4091")+'</span></div><div class="row-k"><span>Assigned_Date</span><span class="mono">'+task.d+'</span></div><div class="row-k"><span>Execution_Result</span><span>—</span></div></div>'}
$("actAudit").onclick=function(){if(task)return;task={id:"TASK-"+hex(4),d:fmtDate(new Date())};drawTask();audit("INSPECTION_TASK_CREATED","مهمة تفتيش موجهة آليًا "+task.id+" للشاغر #VAC-4091","Auto-targeted inspection task "+task.id+" for #VAC-4091","rv");toast(L("أُنشئت مهمة تفتيش ووصلت لتطبيق المفتش الميداني.","An inspection task was created and sent to the field inspector app."))};
$("actEvid").onclick=function(){var e=$("evid");e.hidden=!e.hidden;e.textContent=L("الأدلة: HIST-01 تعليق 80% من الشواغر خلال السنة الماضية · HIST-02 انحراف GPS عن نطاق شرائح NTAG 424 DNA في أكثر من 35% من الزيارات · مؤشر الالتزام 62%.","Evidence: HIST-01 80% of vacancies suspended last year · HIST-02 GPS deviation from the NTAG 424 DNA zone in over 35% of visits · compliance score 62%.");if(!e.hidden)audit("EVIDENCE_VIEWED","عرض تقرير الأدلة للشاغر #VAC-4091","Evidence report viewed for #VAC-4091")};

/* nav highlight */
var links=[].slice.call(document.querySelectorAll("nav.main a"));
if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){links.forEach(function(a){a.classList.toggle("on",a.getAttribute("href")==="#"+en.target.id)})}})},{rootMargin:"-40% 0px -55% 0px"});
["idea","flow","channels","check","verify","geo","predict","results","roadmap"].forEach(function(id){io.observe($(id))})}

/* boot */
try{var sl=localStorage.getItem("yq-lang");if(sl==="en")LANG="en"}catch(e){}
var _drawRail=drawRail;drawRail=function(s){lastRail=s;_drawRail(s)};
var restored=load();
if(!restored){audit("SESSION_START","بدء جلسة العرض التجريبي","Demo session started");$("adText").value=SAMPLES[0].text;extract();}
applyLang();
run(restored);
if(restored&&lastAccepted){vstate="valid";drawVerify()}
save();
if(location.hash){var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView()}
})();
