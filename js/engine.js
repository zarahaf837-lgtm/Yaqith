/*!
 * Yaqith (يقظ) — decision engine
 * Pure logic, no UI: occupation matching, qualification parsing, qualification cap,
 * risk flags (auto-approve only at 0% risk), and geo-compliance calculations.
 * Sources: Saudi Standard Classification of Occupations; "Classification bases and rules" tables 1 and 3.
 */
(function(){
"use strict";
/* ---------- reference data (from the attached classification documents) ---------- */
var EDU=[ // ISCED-11 levels as listed in "أسس وقواعد التصنيف" table 3
 {lv:0,ar:"أقل من الابتدائي",en:"Below primary"},{lv:1,ar:"ابتدائي",en:"Primary"},{lv:2,ar:"متوسط",en:"Intermediate"},
 {lv:3,ar:"ثانوية عامة",en:"Secondary"},{lv:4,ar:"دبلوم بعد الثانوي",en:"Post-secondary diploma"},{lv:5,ar:"دبلوم تعليم عالي قصير",en:"Short higher diploma"},
 {lv:6,ar:"بكالوريوس",en:"Bachelor"},{lv:7,ar:"ماجستير",en:"Master"},{lv:8,ar:"دكتوراه",en:"Doctorate"}];
var GROUPS={ // major group -> name, skill level, derived cap (highest education level of that skill level)
 "1":{ar:"المديرون",en:"Managers",skill:"3-4",cap:8,temp:true},
 "2":{ar:"الاختصاصيون",en:"Professionals",skill:"4",cap:8,temp:true},
 "3":{ar:"الفنيون والاختصاصيون المساعدون",en:"Technicians and associate professionals",skill:"3",cap:5},
 "4":{ar:"عاملو الدعم المكتبي",en:"Clerical support workers",skill:"2",cap:3},
 "5":{ar:"عاملو الخدمات والمبيعات",en:"Service and sales workers",skill:"2",cap:3},
 "6":{ar:"العاملون المهرة في الزراعة والغابات ومزارع الأسماك",en:"Skilled agricultural workers",skill:"2",cap:3},
 "7":{ar:"عاملو الحرف ومن يرتبط بهم",en:"Craft workers",skill:"2",cap:3},
 "8":{ar:"مشغلو المصانع والآلات وعاملو التجميع",en:"Plant and machine operators",skill:"2",cap:3},
 "9":{ar:"المهن الأولية",en:"Elementary occupations",skill:"1",cap:1}};
var OCC_RAW=window.YAQITH_OCCUPATIONS||{}; // Saudi Standard Classification of Occupations (code kept as text)
var OCC_EN={"243110":"Marketing specialist","242127":"Cybersecurity risk specialist","351201":"IT support technician","422601":"Receptionist","412001":"Administrative assistant","523001":"Cashier","522301":"Salesperson","241104":"Treasurer"};
var OCC_ALIAS={"523001":["كاشير"],"243110":["أخصائي تسويق رقمي","مسوق"],"242127":["أخصائي أمن سيبراني"]};
var AMBIG={"241104":"523001"}; // shown together when ambiguous (from the data notes)
var OCC=Object.keys(OCC_RAW).map(function(c){return {code:c,ar:OCC_RAW[c],en:OCC_EN[c]||OCC_RAW[c],alias:OCC_ALIAS[c]||[]}});
var QALIAS=[ // phrase -> level (lowest interpretation where ambiguous)
 {re:/دكتور/,lv:8},{re:/ماجستير/,lv:7},{re:/بكالوريوس|جامعي|جامعة/,lv:6},
 {re:/دبلوم\s*(عالي|تعليم عالي)/,lv:5},{re:/دبلوم/,lv:4},{re:/ثانوي/,lv:3},{re:/متوسط/,lv:2},{re:/ابتدائي/,lv:1}];
var VAGUE=[{re:/مؤهل\s*عال/,lv:5,ar:"مؤهل عالٍ",en:"higher qualification"}];

function norm(s){return String(s||"").replace(/[ً-ْـ]/g,"").replace(/[إأآا]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/\s+/g," ").trim()}
function tokens(s){return norm(s).split(" ").filter(function(w){return w.length>1}).map(function(w){return w.replace(/^ال/,"")})}
function sim(a,b){var A=tokens(a),B=tokens(b);if(!A.length||!B.length)return 0;var inter=A.filter(function(w){return B.indexOf(w)>-1}).length;return inter/Math.max(A.length,B.length)}
OCC.forEach(function(o){o.tk=tokens(o.ar);o.n=norm(o.ar)});
function matchOcc(title){
  var t=norm(title), A=tokens(title);
  var res=OCC.map(function(o){
    var inter=A.length?A.filter(function(w){return o.tk.indexOf(w)>-1}).length:0;
    var s=A.length&&o.tk.length?inter/Math.max(A.length,o.tk.length):0;
    o.alias.forEach(function(a){s=Math.max(s,norm(a)===t?0.97:sim(title,a)*0.92)});
    if(o.n===t)s=0.99;
    return {o:o,s:Math.round(s*100)};
  }).filter(function(x){return x.s>0}).sort(function(a,b){return b.s-a.s}).slice(0,3);
  if(res[0]&&AMBIG[res[0].o.code]){var alt=OCC.filter(function(o){return o.code===AMBIG[res[0].o.code]})[0];res=[res[0],{o:alt,s:Math.max(1,res[0].s-10),amb:true}].concat(res.slice(1).filter(function(x){return x.o.code!==alt.code})).slice(0,3)}
  return res;
}
function parseQual(q){
  var n=norm(q), vague=null;
  VAGUE.forEach(function(v){if(v.re.test(q))vague=v});
  if(vague)return {lv:vague.lv,vague:true,ruleKey:"vague"};
  var found=[];
  QALIAS.forEach(function(a){var m=q.match(new RegExp(a.re.source,"g"));if(m)found.push(a.lv)});
  // remove diploma(4) duplicate when "دبلوم عالي" matched
  if(found.indexOf(5)>-1){found=found.filter(function(x){return x!==4})}
  if(!found.length)return null;
  var lv=Math.min.apply(null,found), rule;
  if(/او|أو/.test(q)&&found.length>1)rule="or";
  else if(/فاعلي|فأعلى|فما فوق/.test(n)||/فأعلى/.test(q))rule="min";
  else rule="direct";
  return {lv:lv,vague:false,ruleKey:rule};
}


/* ---------- assessment: risk model (auto-approval only at 0% risk) ---------- */
var LOW_CONF=60, CLOSE_GAP=15;
function assess(title, qual){
  var m=matchOcc(title), top=m[0], second=m[1];
  var q=parseQual(qual);
  var lowConf=!top||top.s<LOW_CONF||(second&&top.s-second.s<CLOSE_GAP);
  var g=null, cap=null, noGroup=false;
  if(top&&!lowConf){g=GROUPS[top.o.code.charAt(0)];if(g)cap=g.cap;else noGroup=true}
  var flags=[];
  if(!top||lowConf)flags.push({f:"title",rec:"review",ar:"رمز المهنة غير مؤكد أو الثقة ضعيفة (خياران متقاربان: "+m.slice(0,2).map(function(x){return x.o.code+" "+x.o.ar}).join(" / ")+")",en:"Occupation code not confirmed or low confidence (two close options: "+m.slice(0,2).map(function(x){return x.o.code+" "+x.o.en}).join(" / ")+")",rule:"LOW_CONFIDENCE"});
  if(noGroup)flags.push({f:"title",rec:"review",ar:"المجموعة الرئيسية 0 (القوات المسلحة) متعددة المستويات ولا يُشتق لها سقف آلي",en:"Major group 0 (armed forces) has several skill levels, so no automatic cap is derived",rule:"NO_CAP_GROUP"});
  if(!q)flags.push({f:"qual",rec:"review",ar:"تعذّر تحديد مستوى المؤهل من النص",en:"The qualification level could not be determined",rule:"UNKNOWN_QUAL"});
  else if(cap!==null&&q.lv>cap)flags.push({f:"qual",rec:"reject",ar:"المؤهل المطلوب ("+EDU[q.lv].ar+") أعلى من سقف مهنة "+top.o.ar+" ("+EDU[cap].ar+")",en:"Required qualification ("+EDU[q.lv].en+") is above the cap for "+top.o.en+" ("+EDU[cap].en+")",rule:"REQ("+q.lv+") > CAP("+cap+")"});
  else if(q.vague)flags.push({f:"qual",rec:"review",ar:"مؤهل غامض فُسِّر بأدنى تفسير ممكن",en:"Vague qualification read at its lowest interpretation",rule:"VAGUE_QUAL"});
  return {m:m, top:top, q:q, g:g, cap:cap, flags:flags, risk:flags.length?"flagged":"0%", autoApprove:flags.length===0, recommendation:flags.some(function(f){return f.rec==="reject"})?"reject":(flags.length?"review":"approve"), conf:top?top.s:0};
}

/* ---------- geo compliance ---------- */
function rateOf(e){return e.tot?Math.round(e.inz/e.tot*1000)/10:0}
function vioOf(e){return Math.max(0,e.tot-e.inz)}
function statusOf(r){return r>=95?"ok":r>=80?"warn":"crit"}

window.YaqithEngine={EDU:EDU,GROUPS:GROUPS,OCC:OCC,norm:norm,tokens:tokens,matchOcc:matchOcc,parseQual:parseQual,assess:assess,rateOf:rateOf,vioOf:vioOf,statusOf:statusOf};
})();
