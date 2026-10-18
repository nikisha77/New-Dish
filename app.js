const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const ids=["brainButton","brainLabel","modelCard","modelState","voiceCard","voiceState","cookButton","recipeTitle","recipeTagline","recipeSteps","sharePlan","servings","time","leftoverCount","voiceButton","voiceLabel","heroVoice","copyButton","toast","peopleCount","householdCount","safetyNote","usedIngredients","calories","nutritionGrid","nutritionNote","peperAvatar","dishVisual","dishImage","dishCaption","recipeSource","recipeIngredients","missingIngredients","imageInput","scanPreview","scanImage","scanStatus","scanProgress","scanButton","scanResults","scanSuggestions","scanModelState","addScanned","clearScanned"];
const ui=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)])); ui.recipeCard=$(".recipe-card");
let recipes=[], foodVocabulary=[], currentRecipe=null, llmWorker,ttsWorker,visionWorker,ocrWorker,currentAudio,currentAudioUrl,scanImageUrl,scanMode="ocr";
let llmReady=false,llmLoading=false,voiceReady=false,voiceLoading=false,voiceFallback=false,pendingVoiceText=null;
let ocrWorkerPromise=null,ocrReady=false,ocrLoading=false,visionReady=false,visionLoading=false,visionRequest=null;

const ALLERGEN_TERMS={
  peanuts:["peanut","groundnut"], "tree nuts":["almond","cashew","walnut","pecan","pistachio","hazelnut","macadamia","brazil nut","pine nut"],
  dairy:["milk","yogurt","yoghurt","cheese","cream","butter","paneer","ghee","whey","casein","pecorino","parmesan"], eggs:["egg","mayonnaise","meringue"],
  gluten:["wheat","bread","pasta","spaghetti","noodle","flour","barley","rye","couscous","bulgur","seitan"], soy:["soy","soya","tofu","tempeh","edamame","miso"],
  fish:["fish","salmon","tuna","cod","anchovy","sardine","mackerel","haddock"], shellfish:["shrimp","prawn","crab","lobster","mussel","oyster","clam","scallop"],
  sesame:["sesame","tahini"], mustard:["mustard"], celery:["celery","celeriac"], lupin:["lupin","lupine"], sulphites:["sulphite","sulfite","sulfur dioxide","wine","dried fruit"]
};
const FOOD_LABELS=new Set(["apple","orange","banana","broccoli","carrot","sandwich","pizza","hot dog","cake","donut"]);
const OCR_ALIASES=[
  ["capsicum","bell pepper"],["bell peppers","bell pepper"],["yoghurt","yogurt"],["curd","yogurt"],
  ["aubergine","eggplant"],["courgette","zucchini"],["garbanzo beans","chickpeas"],["scallions","spring onion"],
  ["cilantro","coriander"],["maize","corn"],["confectioners sugar","powdered sugar"],["icing sugar","powdered sugar"]
];
const OCR_NOISE=new Set(["a","an","and","or","of","the","fresh","frozen","chopped","diced","sliced","minced","grated","optional","taste","cup","cups","tbsp","tsp","tablespoon","tablespoons","teaspoon","teaspoons","gram","grams","kg","ml","litre","liter","oz","ounce","ounces","lb","lbs","pack","packet","can","cans"]);
const normalize=(v="")=>v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const escapeHtml=v=>{const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML};
function toast(m){ui.toast.textContent=m;ui.toast.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>ui.toast.classList.remove("show"),3000)}
function emojiFor(n){return [["potato","🥔"],["tomato","🍅"],["carrot","🥕"],["rice","🍚"],["lemon","🍋"],["bean","🫘"],["chickpea","🫘"],["spinach","🥬"],["onion","🧅"],["pepper","🫑"],["egg","🥚"],["bread","🍞"],["cheese","🧀"],["apple","🍎"],["banana","🍌"],["orange","🍊"],["broccoli","🥦"]].find(([k])=>normalize(n).includes(k))?.[1]||"🥣"}
function bindIngredient(b){b.onclick=()=>{b.animate([{transform:"scale(1)"},{transform:"scale(.5)",opacity:0}],{duration:180}).onfinish=()=>{b.remove();updateSafetyNote()}}}
function addIngredient(name,card=$(".house-card:not([hidden])"),fromScan=false){if(!name||!card)return null;const clean=name.trim().slice(0,48);if($$(".ingredient",card).some(x=>normalize(x.dataset.name)===normalize(clean)))return null;const b=document.createElement("button");b.type="button";b.className="ingredient";b.dataset.name=clean;if(fromScan)b.dataset.scanAdded="true";b.innerHTML=`${emojiFor(clean)} <span></span><b>×</b>`;$("span",b).textContent=clean;bindIngredient(b);$(".ingredient-list",card).append(b);return b}
$$('.ingredient').forEach(bindIngredient);
$$('.add-form').forEach(f=>f.onsubmit=e=>{e.preventDefault();const i=$("input",f),n=i.value.trim();if(!n)return;addIngredient(n,f.closest(".house-card"));i.value="";updateSafetyNote();toast(`${n} joined the pot!`)});
const neighborInputs=$$('.neighbor-name');
function saveNeighborNames(){try{localStorage.setItem("newDishNeighborNames",JSON.stringify(neighborInputs.map(input=>input.value.trim())))}catch{}}
function applyNeighborName(input,index){const card=input.closest(".house-card"),fallback=`Neighbor ${index+1}`,name=input.value.trim()||fallback;card.dataset.house=name;$(".ingredient-list",card).setAttribute("aria-label",`${name}'s ingredients`);$(".add-form input",card).setAttribute("aria-label",`Add ${name}'s ingredient`)}
let savedNeighborNames=[];try{savedNeighborNames=JSON.parse(localStorage.getItem("newDishNeighborNames")||"[]")}catch{}
neighborInputs.forEach((input,index)=>{if(savedNeighborNames[index])input.value=savedNeighborNames[index];applyNeighborName(input,index);input.addEventListener("input",()=>{applyNeighborName(input,index);saveNeighborNames()});input.addEventListener("blur",()=>{if(!input.value.trim())input.value=`Neighbor ${index+1}`;applyNeighborName(input,index);saveNeighborNames()})});
const clamp=v=>{const n=parseInt(v,10);return Number.isFinite(n)?Math.min(12,Math.max(1,n)):1};
const allergenMatch=(text,a)=>(ALLERGEN_TERMS[a]||[]).some(t=>text.includes(normalize(t)));
const recipeText=r=>normalize(r.ingredients.map(i=>`${i.id} ${i.name?.en||""} ${i.note?.en||""}`).join(" "));
function getKitchenData(){const households=$$(".house-card:not([hidden])").map(c=>({name:c.dataset.house,ingredients:$$(".ingredient",c).map(x=>x.dataset.name)})),preferences=$$('input[data-kind="preference"]:checked').map(x=>x.value),allergies=$$('input[data-kind="allergy"]:checked').map(x=>x.value),servings=clamp(ui.peopleCount.value),blocked=[];ui.peopleCount.value=servings;const safeHouseholds=households.map(h=>({...h,ingredients:h.ingredients.filter(i=>{const hits=allergies.filter(a=>allergenMatch(normalize(i),a));if(hits.length)blocked.push({ingredient:i,hits});return !hits.length})}));return{households,safeHouseholds,preferences,allergies,servings,blocked}}
function updateSafetyNote(){const d=getKitchenData();ui.safetyNote.classList.toggle("alert",!!d.blocked.length);ui.safetyNote.textContent=!d.allergies.length?"No group allergens selected. Always check packaging and cross-contact before serving.":d.blocked.length?`Removed from matching: ${[...new Set(d.blocked.map(x=>x.ingredient))].join(", ")}. Still verify every label and cross-contact risk.`:`Group-wide exclusions: ${d.allergies.join(", ")}. No typed item matched, but packaging and cross-contact still need a human check.`}
ui.householdCount.onclick=e=>{const b=e.target.closest("button[data-count]");if(!b)return;const n=+b.dataset.count;$$('button',ui.householdCount).forEach(x=>x.classList.toggle("active",x===b));$$('.house-card').forEach((c,i)=>c.hidden=i>=n);$$('.pot-path span').forEach((x,i)=>x.hidden=i>=n);ui.peopleCount.value=n===1?1:n*2;$("small",ui.cookButton).textContent=n===1?"Cook for one kitchen":`Mix ${n} kitchens`;updateSafetyNote()};
ui.peopleCount.onchange=()=>ui.peopleCount.value=clamp(ui.peopleCount.value);
$$('.preference-controls input').forEach(i=>i.onchange=()=>{if(i.checked&&["under-30","under-45"].includes(i.value))$$('input[value="under-30"],input[value="under-45"]').forEach(x=>{if(x!==i)x.checked=false});if(i.checked&&i.value==="vegan")$('input[value="vegetarian"]').checked=true;updateSafetyNote()});

function dietMatches(r,p){const d=(r.diets||[]).map(normalize);if(p==="vegetarian")return d.includes("vegetarian")||d.includes("vegan");if(p==="vegan")return d.includes("vegan");if(p==="gluten-free")return d.includes("gluten free");return true}
function chooseRecipe(d){const pantry=d.safeHouseholds.flatMap(h=>h.ingredients).map(normalize).filter(Boolean);return recipes.filter(r=>{const text=recipeText(r),mins=+(r.prepMinutes||0)+ +(r.cookMinutes||0);if(d.allergies.some(a=>allergenMatch(text,a)))return false;if(d.preferences.includes("dairy-free")&&allergenMatch(text,"dairy"))return false;if(["vegetarian","vegan","gluten-free"].some(p=>d.preferences.includes(p)&&!dietMatches(r,p)))return false;if(d.preferences.includes("under-30")&&mins>30)return false;if(d.preferences.includes("under-45")&&mins>45)return false;if(d.preferences.includes("easy")&&normalize(r.difficulty)!=="easy")return false;if(d.preferences.includes("high-protein")&&+(r.nutritionPerServing?.protein||0)<20)return false;if(d.preferences.includes("mild spice")&&/chilli|chili|cayenne|hot pepper|harissa/.test(text))return false;return true}).map(recipe=>{const its=recipe.ingredients.map(i=>normalize(`${i.id} ${i.name?.en||""}`)),matched=[...new Set(pantry.filter(p=>its.some(x=>x.includes(p)||p.includes(x))))];return{recipe,matched,score:matched.length*12-(its.length-matched.length)*.3}}).filter(x=>x.matched.length).sort((a,b)=>b.score-a.score)[0]||null}
function scaled(i,r,s){if(i.quantity==null)return"to taste";const f=s/(r.baseServings||1),v=i.scaling==="fixed"?i.quantity:i.scaling==="damped"?i.quantity*Math.sqrt(f):i.quantity*f,n=v>=10?Math.round(v):Math.round(v*10)/10;return`${n}${i.unit?` ${i.unit}`:""}`}
function fallbackArt(r){const c=document.createElement("canvas");c.width=1000;c.height=560;const x=c.getContext("2d"),g=x.createLinearGradient(0,0,1000,560);g.addColorStop(0,"#f8dc83");g.addColorStop(1,"#ef8979");x.fillStyle=g;x.fillRect(0,0,1000,560);x.textAlign="center";x.font="110px serif";x.fillText(r.ingredients.slice(0,5).map(i=>emojiFor(i.name?.en||i.id)).join(" "),500,250);x.fillStyle="#243026";x.font="bold 54px sans-serif";x.fillText(r.name?.en||"New Dish",500,370);x.font="28px sans-serif";x.fillText("Illustration — not a photograph",500,425);ui.dishVisual.hidden=false;ui.dishImage.src=c.toDataURL();ui.dishCaption.textContent="Locally generated illustration because the source photo was unavailable."}
function renderRecipe(m,d){if(!m){currentRecipe=null;ui.recipeTitle.textContent="No verified match yet";ui.recipeTagline.textContent="Add another main ingredient or relax a non-allergy preference. New Dish will not invent a recipe to fill the gap.";ui.recipeSteps.innerHTML="<li>No unsafe or fabricated fallback was used.</li>";ui.recipeIngredients.innerHTML="<li>Add a few specific ingredients and try again.</li>";ui.missingIngredients.innerHTML="<li>Nothing suggested until a verified recipe matches.</li>";ui.dishVisual.hidden=true;ui.calories.textContent="— kcal";$$('dd[data-nutrient]',ui.nutritionGrid).forEach(x=>x.textContent="Not provided");ui.recipeSource.textContent="No source record selected.";toast("No verified recipe matched those safety choices.");return}
  const r=m.recipe;currentRecipe={r,d,m};const mins=+(r.prepMinutes||0)+ +(r.cookMinutes||0),pantry=d.safeHouseholds.flatMap(h=>h.ingredients).map(normalize),has=i=>pantry.some(p=>normalize(`${i.id} ${i.name?.en||""}`).includes(p)||p.includes(normalize(i.id))),available=r.ingredients.filter(has),missing=r.ingredients.filter(i=>!has(i));
  ui.recipeTitle.textContent=r.name?.en||r.nativeName||"Verified recipe";ui.recipeTagline.textContent=r.summary?.en||`A documented ${r.category||"dish"}.`;ui.servings.textContent=`🍽 Serves ${d.servings}`;ui.time.textContent=`⏱ ${mins} minutes`;ui.leftoverCount.textContent=`♻️ Uses ${available.length} of your ingredients`;
  ui.recipeIngredients.innerHTML=r.ingredients.map(i=>`<li><b>${escapeHtml(i.name?.en||i.id)}</b><span>${escapeHtml(scaled(i,r,d.servings))}${i.note?.en?` · ${escapeHtml(i.note.en)}`:""}</span></li>`).join("");ui.missingIngredients.innerHTML=missing.length?missing.map(i=>`<li>${escapeHtml(i.name?.en||i.id)} <span>${escapeHtml(scaled(i,r,d.servings))}</span></li>`).join(""):"<li>You already listed every recipe ingredient.</li>";
  ui.recipeSteps.innerHTML=r.steps.map((s,i)=>`<li><b>Step ${i+1}${s.minutes?` · ${s.minutes} min`:""}</b><span>${escapeHtml(s.text?.en||"")}</span></li>`).join("");ui.usedIngredients.innerHTML=available.length?available.map(i=>`<span>${escapeHtml(i.name?.en||i.id)}</span>`).join(""):"<span>No exact pantry match</span>";ui.sharePlan.innerHTML=d.safeHouseholds.map(h=>`<span><b>${escapeHtml(h.name)}</b>${escapeHtml(h.ingredients.filter(x=>recipeText(r).includes(normalize(x))).join(", ")||"Help with prep or plating")}</span>`).join("");
  const n=r.nutritionPerServing||{};ui.calories.textContent=Number.isFinite(n.calories)?`${n.calories} kcal`:"Not provided";["protein","carbs","fat"].forEach(k=>{$(`dd[data-nutrient="${k}"]`,ui.nutritionGrid).textContent=Number.isFinite(n[k])?`${n[k]} g`:"Not provided"});ui.recipeSource.innerHTML='Method, timings and nutrition: <a href="https://theunitools.com" target="_blank" rel="noreferrer">UniTools Recipes v1</a> (CC BY-SA 4.0).';
  if(r.photo?.url){ui.dishVisual.hidden=false;ui.dishImage.src=r.photo.url;ui.dishImage.alt=`${ui.recipeTitle.textContent}, source recipe photo`;ui.dishCaption.textContent=`Recipe photo by ${r.photo.author||"source contributor"} · ${r.photo.license||"source license"}`;ui.dishImage.onerror=()=>fallbackArt(r)}else fallbackArt(r);ui.recipeCard.classList.remove("thinking");location.hash="recipe"}

ui.cookButton.onclick=async()=>{const d=getKitchenData();if(!d.safeHouseholds.flatMap(h=>h.ingredients).length)return toast("Add at least one ingredient safe for the group.");ui.recipeCard.classList.add("thinking");ui.cookButton.disabled=true;try{await recipesReady;renderRecipe(chooseRecipe(d),d)}catch{toast("The verified recipe library could not load.")}finally{ui.cookButton.disabled=false;$("small",ui.cookButton).textContent=d.households.length===1?"Cook for one kitchen":`Mix ${d.households.length} kitchens`}};
function initLlm(){if(llmReady||llmLoading)return;llmLoading=true;ui.modelState.textContent="Loading primary model…";ui.brainLabel.textContent="Loading local helper";llmWorker=new Worker("./llm-worker.js",{type:"module"});llmWorker.onmessage=({data})=>{if(data.type==="progress"&&Number.isFinite(data.progress))ui.modelState.textContent=`${data.model||"Model"} · ${Math.round(data.progress)}%`;if(data.type==="fallback")ui.modelState.textContent="Primary failed · trying Qwen2.5";if(data.type==="ready"){llmReady=true;llmLoading=false;ui.modelState.textContent=`${data.model} · ${data.device}`;ui.brainLabel.textContent="Local helper ready";$(".status-dot").classList.add("ready");toast(`${data.model} is ready for optional wording help.`)}if(data.type==="error"){llmLoading=false;ui.modelState.textContent="Unavailable · recipes still work";toast("Model helper unavailable; verified recipes still work.")}};llmWorker.postMessage({type:"load"})}
ui.brainButton.onclick=initLlm;ui.modelCard.onclick=initLlm;
function nutritionSpeech(){const v=Object.fromEntries($$("dd[data-nutrient]",ui.nutritionGrid).map(x=>[x.dataset.nutrient,x.textContent]));return`Nutrition per serving from the source dataset: ${ui.calories.textContent}, protein ${v.protein}, carbohydrates ${v.carbs}, and fat ${v.fat}. Exact values vary with brands and quantities.`}
const recipeSpeech=()=>`${ui.recipeTitle.textContent}. ${ui.recipeTagline.textContent}. ${[...ui.recipeSteps.children].map(x=>x.textContent).join(" ")} ${nutritionSpeech()}`;
const peperSpeaking=x=>ui.peperAvatar.classList.toggle("speaking",x);
function speakWithDeviceVoice(text){
  if(!("speechSynthesis" in window))return toast("No local voice is available in this browser.");
  speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.rate=1.02;
  utterance.onstart=()=>{peperSpeaking(true);ui.voiceLabel.textContent="Peper is speaking…"};
  utterance.onend=utterance.onerror=()=>{peperSpeaking(false);ui.voiceLabel.textContent="Hear Peper read it"};
  speechSynthesis.speak(utterance);
}
function speak(text){if(voiceFallback)return speakWithDeviceVoice(text);if(!voiceReady)return initVoice(true,text);peperSpeaking(true);ui.voiceLabel.textContent="Peper is speaking…";ttsWorker.postMessage({type:"speak",text})}
function initVoice(andSpeak=false,text=recipeSpeech()){
  if(andSpeak)pendingVoiceText=text;
  if(voiceFallback){const queued=pendingVoiceText;pendingVoiceText=null;return queued&&speakWithDeviceVoice(queued)}
  if(voiceReady){const queued=pendingVoiceText;pendingVoiceText=null;return queued&&speak(queued)}
  if(voiceLoading){if(andSpeak)ui.voiceLabel.textContent="Voice is warming up…";return}
  voiceLoading=true;ui.voiceState.textContent="Loading open voice…";ui.voiceLabel.textContent="Warming up Peper…";
  ttsWorker=new Worker("./tts-worker.js",{type:"module"});
  ttsWorker.onmessage=({data})=>{
    if(data.type==="progress"&&Number.isFinite(data.progress)){const p=data.progress<=1?data.progress*100:data.progress;ui.voiceState.textContent=`Loading voice · ${Math.round(p)}%`}
    if(data.type==="ready"){voiceReady=true;voiceLoading=false;ui.voiceState.textContent="Ready · af_heart";ui.voiceLabel.textContent="Hear Peper read it";const queued=pendingVoiceText;pendingVoiceText=null;if(queued)speak(queued)}
    if(data.type==="speaking")peperSpeaking(true);
    if(data.type==="audio"){if(currentAudio)currentAudio.pause();if(currentAudioUrl)URL.revokeObjectURL(currentAudioUrl);currentAudioUrl=URL.createObjectURL(data.blob);currentAudio=new Audio(currentAudioUrl);currentAudio.onended=currentAudio.onerror=()=>{peperSpeaking(false);ui.voiceLabel.textContent="Hear Peper read it"};currentAudio.play().catch(()=>currentAudio.onerror())}
    if(data.type==="error"){voiceLoading=false;voiceFallback=true;peperSpeaking(false);ui.voiceState.textContent="Device voice fallback";ui.voiceLabel.textContent="Hear Peper read it";const queued=pendingVoiceText;pendingVoiceText=null;if(queued)speakWithDeviceVoice(queued);else toast("Open voice unavailable; using this device’s local voice.")}
  };
  ttsWorker.postMessage({type:"load"});
}
ui.voiceButton.onclick=()=>initVoice(true);ui.voiceCard.onclick=()=>initVoice();ui.heroVoice.onclick=()=>initVoice(true,"Hi, I’m Peper. Add what each kitchen has, confirm allergies, then I’ll find a real documented recipe with source nutrition per serving.");
ui.copyButton.onclick=async()=>{if(!currentRecipe)return toast("Choose a verified recipe first.");await navigator.clipboard.writeText(`${ui.recipeTitle.textContent}\n${ui.recipeTagline.textContent}\n\n${ui.recipeIngredients.innerText}\n\n${ui.recipeSteps.innerText}\n\n${nutritionSpeech()}\nSource: UniTools Recipes v1, CC BY-SA 4.0`);toast("Verified recipe copied!")};

function updateScanModelState(){
  if(scanMode==="ocr"){ui.scanModelState.textContent=ocrReady?"OCR ready":ocrLoading?"Preparing OCR…":"OCR not loaded";return}
  ui.scanModelState.textContent=ocrReady&&visionReady?"OCR + vision ready":visionLoading||ocrLoading?"Preparing models…":"Models not loaded";
}
$$('[data-scan-mode]').forEach(b=>b.onclick=()=>{scanMode=b.dataset.scanMode;$$('[data-scan-mode]').forEach(x=>x.classList.toggle("active",x===b));if(scanMode==="fridge")initVision();updateScanModelState()});
ui.imageInput.onchange=()=>{const f=ui.imageInput.files?.[0];if(!f)return;if(scanImageUrl)URL.revokeObjectURL(scanImageUrl);scanImageUrl=URL.createObjectURL(f);ui.scanImage.src=scanImageUrl;ui.scanPreview.hidden=false;ui.scanResults.hidden=true;ui.scanStatus.textContent=scanMode==="ocr"?"Ingredient list selected":"Fridge photo selected";ui.scanProgress.textContent="Ready for on-device analysis.";if(scanMode==="fridge")initVision()};

function percentile(hist,total,q){let seen=0,target=total*q;for(let i=0;i<hist.length;i++){seen+=hist[i];if(seen>=target)return i}return 255}
function otsuThreshold(hist,total){let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let background=0,backgroundWeight=0,best=0,threshold=128;for(let i=0;i<256;i++){backgroundWeight+=hist[i];if(!backgroundWeight)continue;const foregroundWeight=total-backgroundWeight;if(!foregroundWeight)break;background+=i*hist[i];const meanBackground=background/backgroundWeight,meanForeground=(sum-background)/foregroundWeight,variance=backgroundWeight*foregroundWeight*(meanBackground-meanForeground)**2;if(variance>best){best=variance;threshold=i}}return threshold}
function preprocess(img,mode="contrast"){
  const c=document.createElement("canvas"),maxSide=Math.max(img.naturalWidth,img.naturalHeight),s=Math.min(2.5,2200/maxSide);
  c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));
  const x=c.getContext("2d",{willReadFrequently:true});x.imageSmoothingEnabled=true;x.imageSmoothingQuality="high";x.drawImage(img,0,0,c.width,c.height);
  const p=x.getImageData(0,0,c.width,c.height),d=p.data,hist=new Uint32Array(256),gray=new Uint8Array(d.length/4);
  for(let i=0,j=0;i<d.length;i+=4,j++){const g=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);gray[j]=g;hist[g]++}
  const low=percentile(hist,gray.length,.015),high=percentile(hist,gray.length,.985),range=Math.max(36,high-low),threshold=otsuThreshold(hist,gray.length);
  for(let i=0,j=0;i<d.length;i+=4,j++){const g=gray[j],v=mode==="binary"?(g>threshold?255:0):Math.max(0,Math.min(255,(g-low)*255/range));d[i]=d[i+1]=d[i+2]=v}
  x.putImageData(p,0,0);return c;
}
const singularize=w=>w.length>4&&w.endsWith("ies")?`${w.slice(0,-3)}y`:w.length>4&&/(ches|shes|xes|zes|oes)$/.test(w)?w.slice(0,-2):w.length>3&&w.endsWith("s")&&!w.endsWith("ss")?w.slice(0,-1):w;
const ocrWords=v=>normalize(v).split(" ").filter(Boolean).map(singularize).filter(w=>!OCR_NOISE.has(w)&&!/^\d+$/.test(w));
function editDistance(a,b){const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const above=row[j],cost=a[i-1]===b[j-1]?0:1;row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+cost);diagonal=above}}return row[b.length]}
function wordSimilarity(a,b){if(a===b)return 1;if(Math.min(a.length,b.length)<=3)return 0;return 1-editDistance(a,b)/Math.max(a.length,b.length)}
function foodMatchScore(segment,foodKey){
  const words=ocrWords(segment),keyWords=ocrWords(foodKey);if(!words.length||!keyWords.length)return 0;
  const hay=` ${words.join(" ")} `,needle=` ${keyWords.join(" ")} `;if(hay.includes(needle))return 1;
  if(keyWords.length>words.length)return 0;
  const scores=keyWords.map(key=>Math.max(...words.map(word=>wordSimilarity(key,word))));
  if(scores.some((score,i)=>score<(keyWords[i].length<=4?1:.78)))return 0;
  return scores.reduce((sum,score)=>sum+score,0)/scores.length;
}
function knownFoodsInText(results){
  const found=new Map;
  for(const data of results){const ocrConfidence=Math.max(.45,Math.min(1,(data.confidence||65)/100)),segments=(data.text||"").split(/[\n,;•·|]+/).map(x=>x.trim()).filter(Boolean);
    for(const segment of segments)for(const food of foodVocabulary){const score=foodMatchScore(segment,food.key);if(score<.8)continue;const confidence=Math.min(.98,(.68+.3*score)*(.78+.22*ocrConfidence)),key=normalize(food.name),item={name:food.name,confidence,source:score===1?"OCR exact":"OCR likely"};if(!found.has(key)||found.get(key).confidence<confidence)found.set(key,item)}
  }
  return[...found.values()].sort((a,b)=>b.confidence-a.confidence).slice(0,18);
}
function suggestionKey(name){let key=ocrWords(name).join(" ");for(const[alias,target]of OCR_ALIASES)if(key===ocrWords(alias).join(" "))key=ocrWords(target).join(" ");return key}
function suggestions(items){const byName=new Map;for(const item of items){const key=suggestionKey(item.name);if(!key)continue;const old=byName.get(key);if(!old||item.confidence>old.confidence)byName.set(key,item)}const clean=[...byName.values()].sort((a,b)=>b.confidence-a.confidence);ui.scanResults.hidden=false;ui.scanSuggestions.innerHTML=clean.length?clean.map(x=>`<label><input type="checkbox" value="${escapeHtml(x.name)}" ${x.confidence>=.74?"checked":""}><span>${emojiFor(x.name)} ${escapeHtml(x.name)} <small>${x.source} · ${Math.round(x.confidence*100)}%</small></span></label>`).join(""):"<p>No reliable food was found. Try a brighter, closer photo or type the ingredient manually.</p>";return clean}
function initOcr(){
  if(ocrWorkerPromise)return ocrWorkerPromise;ocrLoading=true;updateScanModelState();
  ocrWorkerPromise=import("https://cdn.jsdelivr.net/npm/tesseract.js@6/+esm").then(async({createWorker})=>{
    ocrWorker=await createWorker("eng",1,{logger:m=>{if(m.progress!=null)ui.scanProgress.textContent=`${m.status} · ${Math.round(m.progress*100)}%`}});
    await ocrWorker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1",user_defined_dpi:"300"});
    ocrReady=true;ocrLoading=false;updateScanModelState();return ocrWorker;
  }).catch(error=>{ocrWorkerPromise=null;ocrLoading=false;ocrReady=false;updateScanModelState();throw error});
  return ocrWorkerPromise;
}
async function ensureImageReady(){if(!ui.scanImage.src)throw Error("No image selected");if(!ui.scanImage.complete||!ui.scanImage.naturalWidth)await ui.scanImage.decode();if(!ui.scanImage.naturalWidth)throw Error("Image could not be decoded")}
async function ocr(){
  await ensureImageReady();ui.scanStatus.textContent=ocrReady?"Reading ingredient text…":"Preparing open OCR…";const w=await initOcr(),results=[];
  ui.scanProgress.textContent="Enhancing contrast for the first pass…";results.push((await w.recognize(preprocess(ui.scanImage,"contrast"))).data);
  const firstMatches=knownFoodsInText(results);
  if((results[0].confidence||0)<88||firstMatches.length<2){ui.scanProgress.textContent="Checking a high-contrast second pass…";results.push((await w.recognize(preprocess(ui.scanImage,"binary"))).data)}
  return knownFoodsInText(results);
}
function ensureVisionWorker(){
  if(visionWorker)return visionWorker;visionWorker=new Worker("./vision-worker.js",{type:"module"});
  visionWorker.onmessage=({data})=>{if(data.type==="progress"&&Number.isFinite(data.progress)){const p=data.progress<=1?data.progress*100:data.progress;ui.scanProgress.textContent=`Vision model · ${Math.round(p)}%`}if(data.type==="ready"){visionReady=true;visionLoading=false;updateScanModelState()}if(data.type==="result"&&visionRequest){visionRequest.resolve(data.items);visionRequest=null}if(data.type==="error"){visionLoading=false;updateScanModelState();if(visionRequest){visionRequest.reject(Error(data.message));visionRequest=null}}};
  return visionWorker;
}
function initVision(){if(visionReady||visionLoading)return;visionLoading=true;updateScanModelState();ensureVisionWorker().postMessage({type:"load"})}
function detectWithVision(image){return new Promise((resolve,reject)=>{visionRequest={resolve,reject};ensureVisionWorker().postMessage({type:"detect",image})})}
async function vision(){const a=ocr().catch(()=>[]);ui.scanStatus.textContent=visionReady?"Reading fridge photo…":"Preparing fridge vision…";const b=detectWithVision(ui.scanImage.src).then(items=>items.filter(x=>FOOD_LABELS.has(normalize(x.label))&&x.score>=.7).map(x=>({name:x.label,confidence:x.score,source:"Vision"}))).catch(()=>[]);const[o,v]=await Promise.all([a,b]);return[...o,...v]}
ui.scanButton.onclick=async()=>{ui.scanButton.disabled=true;ui.scanProgress.textContent="Models stay loaded for faster repeat scans.";try{const x=scanMode==="ocr"?await ocr():await vision(),shown=suggestions(x);ui.scanStatus.textContent="Review before adding";ui.scanProgress.textContent=`${shown.length} possible ingredient${shown.length===1?"":"s"} found.`}catch{ui.scanStatus.textContent="Scan could not finish";ui.scanProgress.textContent="Check the image and the first-download connection."}finally{ui.scanButton.disabled=false}};
ui.addScanned.onclick=()=>{const x=$$('#scanSuggestions input:checked').map(i=>i.value),added=x.map(i=>addIngredient(i,$(".house-card:not([hidden])"),true)).filter(Boolean);updateSafetyNote();toast(`${added.length} confirmed ingredient${added.length===1?"":"s"} added.`)};
ui.clearScanned.onclick=()=>{const added=$$('.ingredient[data-scan-added="true"]');added.forEach(x=>x.remove());ui.scanResults.hidden=true;ui.scanSuggestions.innerHTML="";updateSafetyNote();toast(`${added.length} scanned item${added.length===1?"":"s"} cleared.`)};

const recipesReady=fetch("./data/recipes.json").then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{recipes=d.recipes||[];const map=new Map;for(const recipe of recipes)for(const item of recipe.ingredients||[]){const name=item.name?.en||item.id,key=normalize(name);if(key.length>=3&&!map.has(key))map.set(key,{key,name});const id=normalize(item.id),idName=id?`${id[0].toUpperCase()}${id.slice(1)}`:"";if(id.length>=3&&!map.has(id))map.set(id,{key:id,name:idName})}for(const[key,name]of OCR_ALIASES)if(!map.has(normalize(key)))map.set(normalize(key),{key:normalize(key),name});foodVocabulary=[...map.values()].sort((a,b)=>b.key.length-a.key.length);return recipes});
updateSafetyNote();recipesReady.then(()=>renderRecipe(chooseRecipe(getKitchenData()),getKitchenData())).catch(()=>toast("Verified recipe library could not load."));
updateScanModelState();
initOcr().catch(()=>{ui.scanProgress.textContent="OCR will retry when you scan."});
initVoice();
window.addEventListener("beforeunload",()=>{ocrWorker?.terminate();if(scanImageUrl)URL.revokeObjectURL(scanImageUrl);if(currentAudioUrl)URL.revokeObjectURL(currentAudioUrl)});
